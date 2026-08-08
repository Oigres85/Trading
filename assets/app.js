/* Trading Dashboard — rendering lato client di data/data.json */
const REPO = "Oigres85/Trading";
/* Versione del build: DEVE combaciare col ?v=NN in index.html — bump insieme a ogni release.
   Timbrata in cima al payload (buildCIOText) così il CEO verifica a colpo d'occhio se Safari ha
   servito il codice aggiornato: se il timbro dice una versione vecchia = pagina in cache stale. */
const BUILD_VERSION = "251";
let DATA = null;
let sparkRange = localStorage.getItem("pref_range") || "m1";   // 1G | 1M | 1A (preferenza ricordata)

/* ordinamento tabelle: click su intestazione → desc → asc → default */
const SORT_FIELDS = {
  /* ⚠ v251 — RICALCOLATI. Il taglio di "Segnale" (indice 17) stava IN MEZZO alla tabella e ha
     spostato ogni indice successivo: CLAUDE.md avverte che l'accesso è per INDICE e che un
     taglio interno va ricalcolato, a differenza dei tagli in coda del v208.
     ptf: Titolo,Qtà,PMC,Prezzo,Oggi,Pre/After,Volume,Guadagno,Guad.%,Beta,Sharpe,Sortino,
          Supporto,Resistenza,ΔSMA200,RS 1M,RS NDX,Short%,Float,Drawdown,Opzioni,Trimestrale,
          Debt/Equity,Div Yield,Ricavi,Utile netto,Marg.netto,Cresc.ricavi  → 28 */
  "ptf-table": ["name", "qty", "pmc", "price", "change_pct", "prepost_chg", "volume",
                "gain", "gain_pct", "beta", "sharpe_1y", "sortino_1y", "support",
                "resistance", "sma200_dist_pct", "rs_1m", "rs_ndx_1m",
                "stat:short_float", "stat:float_shares", "w52_dist_pct", null, "earnings_date",
                "stat:debt_to_equity", "stat:dividend_yield",
                "fin:revenue", "fin:net_income", "fin:margin", "fin:cagr"],
  /* wl: Titolo,Prezzo,Oggi,Pre/After,Volume,Beta,Sharpe,Sortino,Supporto,Resistenza,ΔSMA200,
         RS 1M,RS NDX,Short%,Float,Drawdown,Opzioni,Trimestrale,Debt/Equity,Div Yield,
         Ricavi,Utile netto,Marg.netto,Cresc.ricavi  → 24 */
  "wl-table": ["name", "price", "change_pct", "prepost_chg", "volume",
               "beta", "sharpe_1y", "sortino_1y", "support", "resistance", "sma200_dist_pct",
               "rs_1m", "rs_ndx_1m", "stat:short_float", "stat:float_shares", "w52_dist_pct",
               null, "earnings_date", "stat:debt_to_equity", "stat:dividend_yield",
               "fin:revenue", "fin:net_income", "fin:margin", "fin:cagr"],
};
const sortState = {
  "ptf-table": { field: null, dir: 0 }, "wl-table": { field: null, dir: 0 },
};

function sortVal(r, field) {
  if (field === "prepost_chg") return r.prepost?.change_pct ?? null;
  if (field === "upside_pct") return r.rating?.upside_pct ?? null;
  if (field === "pfcf") {                    // P/FCF calcolato al volo
    const st = r.stats || {};
    return (st.market_cap && st.fcf) ? st.market_cap / st.fcf : null;
  }
  if (field && field.startsWith("stat:")) return r.stats?.[field.slice(5)] ?? null;
  return r[field] ?? null;
}

function sortRows(rows, tableId) {
  const { field, dir } = sortState[tableId];
  if (!field || !dir) return rows;
  return [...rows].sort((a, b) => {
    const va = sortVal(a, field), vb = sortVal(b, field);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;          // i valori mancanti sempre in fondo
    if (vb === null) return -1;
    if (typeof va === "string") return dir === 1 ? vb.localeCompare(va) : va.localeCompare(vb);
    return dir === 1 ? vb - va : va - vb;
  });
}

function updateSortArrows(tableId) {
  const { field, dir } = sortState[tableId];
  document.querySelectorAll(`#${tableId} thead th`).forEach((th, i) => {
    th.querySelector(".sort-arrow")?.remove();
    const f = SORT_FIELDS[tableId][Number(th.dataset.col ?? i)];
    if (f && f === field && dir) {
      const s = document.createElement("span");
      s.className = "sort-arrow";
      s.textContent = dir === 1 ? " ▼" : " ▲";
      th.appendChild(s);
    }
  });
}

/* ═══ v165 — ORDINE DELLE COLONNE personalizzabile (drag & drop sull'intestazione) ═══════
   L'ordine vive in localStorage per-tabella come permutazione degli indici ORIGINALI, così
   SORT_FIELDS (che mappa indice→campo) resta valido: ogni th porta `data-col` con il suo indice
   di partenza e sort/label lo usano al posto della posizione corrente nel DOM.
   ⚠ Riguarda SOLO le tabelle HTML. Le tabelle del PROMPT restano a colonne fisse: il red team
   (I6 col.16=Supp./17=Stop, I10 per nome) verifica per posizione, riordinarle romperebbe tutto. */
/* ═══ v188 — COLONNE NASCONDIBILI (richiesta CEO).
   ⚠ RIGUARDA SOLO LE TABELLE HTML. Il payload del prompt lo costruisce mdRow(), che non legge
   nulla di tutto questo: nascondere una colonna nella dashboard NON toglie un dato all'LLM.
   E' una scelta deliberata — il CEO guarda poche colonne, l'analista ne vuole tutte.
   La chiave e' l'indice ORIGINALE della colonna (data-col), lo stesso su cui poggia il
   riordino: cosi' nascondere e spostare si compongono senza interferire. */
const colHiddenKey = (tid) => `colhidden_${tid}`;
/* ═══ v198 — VISTA COMPATTA DI DEFAULT. Nessuna colonna viene rimossa: cambia solo quali sono
   ACCESE all'apertura. La tabella a 38 colonne conteneva tutto e non faceva vedere niente; una
   a otto si legge, e le altre trenta restano a un clic da "⚙ Colonne" o nella scheda del titolo.
   Le otto sono scelte per un criterio: sono quelle che servono a decidere se una posizione
   richiede attenzione — peso, rischio che genera, forza relativa, risultato, e il segnale.
   La preferenza dell'utente ha SEMPRE la precedenza: il default si applica solo la prima volta,
   e una volta scelto qualcosa non viene mai sovrascritto. */
/* ⚠ v206 — QUI IL COMMENTO MENTIVA. La watchlist dichiarava "Titolo Prezzo Oggi RS RSndx
   Segnale Trimestrale" ma gli indici 5 e 6 sono Beta e Sharpe 1A: la forza relativa — cioè il
   filtro leader/laggard, l'unica ragione per cui si guarda una watchlist di 27 titoli — NON
   era nella vista di default, al contrario di quanto il commento affermava e al contrario del
   portafoglio. Nessun test lo intercettava. Ora gli indici seguono il commento (RS 1M = 11,
   RS NDX 1M = 12) e un check verifica che le due cose non divergano più. */
const VISTA_COMPATTA = {
  /* ⚠ v251 — RICALCOLATA insieme a SORT_FIELDS: "Segnale" era l'indice 17 del portafoglio e il
     13 della watchlist, entrambi DENTRO la vista compatta. Al suo posto entra il MARGINE NETTO,
     che è un fatto e non un'etichetta derivata. */
  "ptf-table": [0, 1, 3, 4, 8, 15, 16, 21, 26],   // Titolo Qtà Prezzo Oggi Guad.% RS RSndx Trimestrale Marg.netto
  "wl-table":  [0, 1, 2, 11, 12, 17, 22],          // Titolo Prezzo Oggi RS RSndx Trimestrale Marg.netto
};
/* v206 — RIPARAZIONE DI UN DEFAULT SBAGLIATO, non sovrascrittura di una scelta.
   La vista compatta si applica UNA VOLTA SOLA: un browser che ha già ricevuto il default
   difettoso della watchlist (Beta e Sharpe al posto della forza relativa) non vedrebbe mai la
   correzione. Ma quel contenuto non è mai stato SCELTO dall'utente — gliel'ha imposto il codice.
   Quindi si ripara solo se le colonne nascoste sono ESATTAMENTE quelle che il vecchio default
   produceva: se l'utente ha toccato qualcosa, anche una sola colonna, la sua scelta resta.
   Vale una volta, poi la chiave impedisce di ripassarci. */
const VECCHIA_COMPATTA_WL = [0, 1, 2, 5, 6, 13, 18];
function riparaVistaCompattaWl() {
  const tid = "wl-table", chiave = "vista_riparata_v206";
  try {
    if (localStorage.getItem(chiave)) return;
    localStorage.setItem(chiave, "1");
    const salvate = loadColHidden(tid);
    if (!salvate.size) return;                              // mai applicata: ci pensa il default
    const head = document.querySelector(`#${tid} thead tr`);
    if (!head) return;
    const vecchie = new Set([...head.children].map((_, i) => i).filter(i => !VECCHIA_COMPATTA_WL.includes(i)));
    const uguali = vecchie.size === salvate.size && [...vecchie].every(i => salvate.has(i));
    if (!uguali) return;                                    // l'utente ha scelto: non si tocca
    const nuove = new Set([...head.children].map((_, i) => i).filter(i => !VISTA_COMPATTA[tid].includes(i)));
    saveColHidden(tid, nuove);
  } catch { /* localStorage non disponibile */ }
}

function applicaVistaCompattaSePrimaVolta(tid) {
  const chiaveFatto = `vista_iniziale_${tid}`;
  if (localStorage.getItem(chiaveFatto)) return;           // gia' deciso: non si tocca piu'
  try { localStorage.setItem(chiaveFatto, "1"); } catch { /* quota */ }
  if (localStorage.getItem(colHiddenKey(tid))) return;     // l'utente ha gia' scelto: si rispetta
  const head = document.querySelector(`#${tid} thead tr`);
  if (!head) return;
  const visibili = new Set(VISTA_COMPATTA[tid] || []);
  const nascoste = new Set([...head.children].map((_, i) => i).filter(i => !visibili.has(i)));
  saveColHidden(tid, nascoste);
}
/* interruttore compatta/completa: una riga sola, e dice quante colonne stai vedendo */
function renderVistaSwitch(tid, contenitore) {
  const el = document.querySelector(contenitore);
  if (!el) return;
  const head = document.querySelector(`#${tid} thead tr`);
  if (!head) return;
  const tot = head.children.length;
  const nasc = loadColHidden(tid).size;
  el.innerHTML = `<span class="vs-lab">${tot - nasc}/${tot} colonne</span>
    <button class="chip${nasc ? " chip-active" : ""}" data-vista="compatta" data-t="${tid}">Compatta</button>
    <button class="chip${nasc ? "" : " chip-active"}" data-vista="completa" data-t="${tid}">Completa</button>`;
}

function loadColHidden(tid) {
  try {
    const a = JSON.parse(localStorage.getItem(colHiddenKey(tid)) || "[]");
    return new Set(Array.isArray(a) ? a.filter(Number.isInteger) : []);
  } catch { return new Set(); }
}
function saveColHidden(tid, set) {
  try { localStorage.setItem(colHiddenKey(tid), JSON.stringify([...set])); } catch { /* quota */ }
}
/* applica la visibilita' a thead e righe dati, e RESTRINGE il colspan delle righe speciali
   (TOTALE, "+ Aggiungi titolo", nota BTP) di quante colonne coperte sono nascoste — senza
   questo la riga TOTALE sborderebbe e la tabella si disallineerebbe visivamente. */
function applyColVisibility(tid) {
  const head = document.querySelector(`#${tid} thead tr`);
  if (!head) return;
  const nascoste = loadColHidden(tid);
  const ths = [...head.children];
  ths.forEach((th, i) => { if (th.dataset.col == null) th.dataset.col = String(i); });
  const nCol = ths.length;
  const mostra = (cell) => {
    const c = Number(cell.dataset.col ?? -1);
    cell.hidden = c >= 0 && nascoste.has(c);
  };
  ths.forEach(mostra);
  const ordine = ths.map(th => Number(th.dataset.col));      // ordine di VISUALIZZAZIONE corrente
  document.querySelectorAll(`#${tid} tbody tr`).forEach(tr => {
    const cells = [...tr.children];
    if (cells.length === nCol) { cells.forEach((td, i) => { if (td.dataset.col == null) td.dataset.col = String(ordine[i]); }); cells.forEach(mostra); return; }
    // riga speciale: si accorcia ogni colspan di quante colonne coperte sono nascoste
    let usate = 0;
    for (const td of cells) {
      const span = Number(td.getAttribute("colspan") || 1);
      if (td.dataset.span0 == null) td.dataset.span0 = String(span);
      const orig = Number(td.dataset.span0);
      const coperte = ordine.slice(usate, usate + orig);
      const nasc = coperte.filter(c => nascoste.has(c)).length;
      const nuovo = Math.max(1, orig - nasc);
      if (orig > 1) td.setAttribute("colspan", String(nuovo)); else td.hidden = nasc > 0;
      usate += orig;
    }
  });
}
/* pannello di scelta: una casella per colonna, nell'ordine in cui compaiono ora */
function openColumnPicker(tid, etichetta, rerender) {
  const head = document.querySelector(`#${tid} thead tr`);
  if (!head) return;
  const ths = [...head.children];
  const nascoste = loadColHidden(tid);
  const voci = ths.map(th => {
    const c = Number(th.dataset.col ?? 0);
    const nome = (th.textContent || "").trim() || `Colonna ${c + 1}`;
    const bloccata = th.classList.contains("sticky-col");   // il nome del titolo non si nasconde
    return `<label class="cp-item${bloccata ? " cp-locked" : ""}">
      <input type="checkbox" data-cp="${c}" ${nascoste.has(c) ? "" : "checked"} ${bloccata ? "disabled" : ""}>
      <span>${esc(nome)}</span>${bloccata ? '<em class="muted">sempre visibile</em>' : ""}</label>`;
  }).join("");
  openInfoModal(`Colonne — ${etichetta}`, `
    <div class="cp-note muted">Scegli cosa vedere in tabella. <b>Non tocca il prompt AI</b>: il payload
      continua a contenere tutti i dati, comprese le colonne che nascondi qui.
      Il dettaglio completo di ogni titolo resta a un clic sul suo <b>nome</b>.</div>
    <div class="cp-grid" data-cp-table="${tid}">${voci}</div>
    <div class="pp-actions">
      <button class="btn btn-ghost btn-sm" data-cp-all="${tid}">Mostra tutte</button>
      <button class="btn btn-primary btn-sm" data-cp-done="1">Fatto</button>
    </div>`);
  const grid = document.querySelector(`.cp-grid[data-cp-table="${tid}"]`);
  grid?.addEventListener("change", (e) => {
    const cb = e.target.closest("input[data-cp]");
    if (!cb) return;
    const c = Number(cb.dataset.cp);
    const set = loadColHidden(tid);
    if (cb.checked) set.delete(c); else set.add(c);
    saveColHidden(tid, set);
    rerender();
  });
}

const colOrderKey = (tid) => `colorder_${tid}`;
function loadColOrder(tid, n) {
  try {
    const a = JSON.parse(localStorage.getItem(colOrderKey(tid)) || "null");
    if (Array.isArray(a) && a.length === n && a.every(i => Number.isInteger(i) && i >= 0 && i < n)
        && new Set(a).size === n) return a;
  } catch { /* ordine corrotto o schema cambiato → si torna al default */ }
  return null;
}
function saveColOrder(tid, order) {
  try { localStorage.setItem(colOrderKey(tid), JSON.stringify(order)); } catch { /* quota */ }
}
function resetColOrder(tid) {
  try { localStorage.removeItem(colOrderKey(tid)); } catch { /* no-op */ }
}
/* applica la permutazione a thead e a ogni riga dati (le righe con celle in colspan — TOTALE,
   "+ Aggiungi titolo", note BTP — hanno un numero di celle diverso e vengono saltate) */
function applyColOrder(tid) {
  const head = document.querySelector(`#${tid} thead tr`);
  if (!head || !head.children) return;
  const ths = [...head.children];
  ths.forEach((th, i) => { if (th.dataset.col == null) th.dataset.col = String(i); });
  const order = loadColOrder(tid, ths.length);
  if (!order) return;
  const place = (row) => {
    const cells = [...row.children];
    if (cells.length !== order.length) return;             // riga speciale: non toccarla
    order.forEach(orig => {
      const c = cells.find(x => Number(x.dataset.col ?? -1) === orig);
      if (c) row.appendChild(c);
    });
  };
  head.querySelectorAll("th").forEach((th, i) => { if (th.dataset.col == null) th.dataset.col = String(i); });
  place(head);
  document.querySelectorAll(`#${tid} tbody tr`).forEach(tr => {
    const cells = [...tr.children];
    if (cells.length !== order.length) return;
    cells.forEach((td, i) => { if (td.dataset.col == null) td.dataset.col = String(i); });
    place(tr);
  });
}
/* trascinamento dell'intestazione per spostare una colonna a sinistra/destra */
function initColDrag(tid, rerender) {
  const head = document.querySelector(`#${tid} thead tr`);
  if (!head || !head.children || head.dataset?.dragReady === "1") return;
  head.dataset.dragReady = "1";
  const ths = [...head.children];
  ths.forEach((th, i) => {
    if (th.dataset.col == null) th.dataset.col = String(i);
    th.draggable = true;
    th.classList.add("col-draggable");
    th.title = (th.title ? th.title + " · " : "") + "Trascina per spostare la colonna";
    th.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", th.dataset.col);
      th.classList.add("col-dragging");
    });
    th.addEventListener("dragend", () => {
      th.classList.remove("col-dragging");
      document.querySelectorAll(`#${tid} thead th`).forEach(x => x.classList.remove("col-over"));
    });
    th.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; th.classList.add("col-over"); });
    th.addEventListener("dragleave", () => th.classList.remove("col-over"));
    th.addEventListener("drop", (e) => {
      e.preventDefault();
      th.classList.remove("col-over");
      const from = Number(e.dataTransfer.getData("text/plain"));
      const to = Number(th.dataset.col);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return;
      const cur = loadColOrder(tid, ths.length) || ths.map((_, k) => k);
      const iFrom = cur.indexOf(from), iTo = cur.indexOf(to);
      if (iFrom < 0 || iTo < 0) return;
      cur.splice(iTo, 0, ...cur.splice(iFrom, 1));         // sposta la colonna nella posizione di rilascio
      saveColOrder(tid, cur);
      rerender();
      toast("Ordine colonne aggiornato — doppio clic sull'intestazione per ripristinare");
    });
    // doppio clic = ripristino dell'ordine originale (scorciatoia senza UI extra)
    th.addEventListener("dblclick", (e) => {
      if (!loadColOrder(tid, ths.length)) return;
      e.preventDefault(); e.stopPropagation();
      resetColOrder(tid); rerender();
      toast("Ordine colonne ripristinato");
    });
  });
}

function initSorting(tableId, rerender) {
  document.querySelectorAll(`#${tableId} thead th`).forEach((th, i) => {
    const f = SORT_FIELDS[tableId][Number(th.dataset.col ?? i)];
    if (!f) return;
    th.classList.add("sortable");
    th.addEventListener("click", () => {
      const st = sortState[tableId];
      if (st.field !== f) { st.field = f; st.dir = 1; }
      else st.dir = (st.dir + 1) % 3;     // desc → asc → default
      if (!st.dir) st.field = null;
      rerender();
      updateSortArrows(tableId);
    });
  });
}

const $ = (sel) => document.querySelector(sel);
const fmtEUR = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const fmtUSD = new Intl.NumberFormat("it-IT", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtNum = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function cur(row) { return row.currency === "EUR" ? "€" : row.currency === "PTS" ? "" : "$"; }
function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }
function priceTxt(r, c) { return r.price == null ? "…" : (c ?? cur(r)) + fmtNum.format(r.price); }
function signCls(v) { return v > 0 ? "pos" : v < 0 ? "neg" : ""; }
function signTxt(v, suffix = "%") {
  if (v === null || v === undefined) return "—";
  return (v > 0 ? "+" : "") + fmtNum.format(v) + suffix;
}
// [⚡ASIMM] (v136): motore di volatilità asimmetrica RIALZISTA — Sortino 1A supera lo Sharpe 1A
// di oltre il 70% (varianza quasi tutta al rialzo) CON momentum in corso (RSI>55). Su questi
// titoli la testata vieta le prese di beneficio da ipercomprato RSI: solo stop ratchet 2×ATR.
function isAsimm(r) {
  const sh = r.sharpe_1y, so = r.sortino_1y, rsi = r.rsi;
  return sh != null && so != null && sh > 0 && so / sh > 1.7 && rsi != null && rsi > 55;
}
function signalTxt(r) { return `${r.signal ?? "—"}${isAsimm(r) ? " [⚡ASIMM]" : ""}`; }

// Polymarket Δ7g (v136): storico client-side delle probabilità (localStorage, un punto/giorno)
// → velocità del sentiment speculativo macro. Senza 7 giorni di storico → "[Δ7g —]".
function pmHist() { try { return JSON.parse(localStorage.getItem("polymarket_hist") || "{}"); } catch { return {}; } }
function recordPolymarket() {
  const preds = (typeof DATA !== "undefined" && DATA && DATA.predictions) || [];
  if (!preds.length) return;
  const today = new Date().toISOString().slice(0, 10);
  const h = pmHist();
  for (const p of preds) {
    if (p.question == null || p.yes == null) continue;
    const arr = h[p.question] || [];
    if (arr.length && arr[arr.length - 1][0] === today) arr[arr.length - 1] = [today, p.yes];   // aggiorna oggi
    else arr.push([today, p.yes]);
    h[p.question] = arr.slice(-45);   // ~45 giorni di storico, basta per Δ7g/Δ30g
  }
  try { localStorage.setItem("polymarket_hist", JSON.stringify(h)); } catch { /* quota/blocco: best-effort */ }
}
function pmDelta7(question, yesNow) {
  const arr = pmHist()[question] || [];
  const target = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  let past = null;
  for (const [d, v] of arr) { if (d <= target) past = v; }   // il valore più recente con data ≤ 7g fa
  return past != null ? Math.round(yesNow - past) : null;
}

// URL raw: bypassa il CDN di GitHub Pages (nessun cache edge), dati sempre freschi.
// Pages URL come fallback (CORS block su raw in ambienti aziendali).
const RAW_URL = () => `https://raw.githubusercontent.com/${REPO}/main/data/data.json?t=${Date.now()}`;
const PAGES_URL = () => `data/data.json?t=${Date.now()}`;

async function fetchData() {
  const sane = (s) => s.replace(/\bNaN\b/g, "null").replace(/-?\bInfinity\b/g, "null");
  try {
    const res = await fetch(RAW_URL(), { cache: "no-store" });
    if (!res.ok) throw new Error(`raw ${res.status}`);
    return JSON.parse(sane(await res.text()));
  } catch {
    // fallback: Pages URL (può avere latenza CDN di alcuni minuti)
    const res2 = await fetch(PAGES_URL(), { cache: "no-store" });
    return JSON.parse(sane(await res2.text()));
  }
}

async function loadData(showSpin = false) {
  const btn = $("#btn-refresh");
  if (showSpin) btn.classList.add("spinning");
  try {
    // i proxy/CDN gratuiti a volte falliscono: riprovo fino a 3 volte prima di arrendermi
    let lastErr;
    for (let i = 0; i < 3; i++) {
      try { DATA = await fetchData(); lastErr = null; break; }
      catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 1200 * (i + 1))); }
    }
    if (lastErr) throw lastErr;
    mergeManualHoldings();        // reintegra le posizioni aggiunte a mano (localStorage)
    applyMacroOverrides();        // correzioni manuali dei dati macro flaggati (decadono da sole)
    renderAll();
    livePrices();
    if (showSpin) toast("Dati ricaricati ✓");
  } catch (e) {
    console.error(e);
    // se non ho mai caricato dati, mostro un avviso invece di una pagina vuota
    if (!DATA) {
      const el = $("#earnings-alert");
      if (el) { el.hidden = false; el.className = "data-error"; el.innerHTML = `⚠ Impossibile caricare i dati (rete/proxy). <button class="btn btn-ghost btn-sm" onclick="loadData(true)">Riprova</button>`; }
    }
    if (showSpin) toast("Errore nel caricamento dati — riprovo tra poco");
  } finally {
    btn.classList.remove("spinning");
  }
}

/* Token GitHub (fine-grained, repo Oigres85/Trading, permessi Actions:read&write +
   Contents:read&write), chiesto UNA SOLA VOLTA e salvato solo in questo browser. */
function getToken() {
  let token = localStorage.getItem("gh_token");
  if (!token) {
    token = window.prompt(
      "Una sola volta: incolla un token GitHub del repo " + REPO +
      " (fine-grained, permessi Actions e Contents: read & write).\n" +
      "Resta salvato solo in questo browser, non te lo chiederà più.");
    if (token) { token = token.trim(); localStorage.setItem("gh_token", token); }
  }
  return token;
}

function ghHeaders(token) {
  return { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json" };
}

async function dispatchWorkflow(token) {
  return fetch(`https://api.github.com/repos/${REPO}/actions/workflows/update-data.yml/dispatches`, {
    method: "POST", headers: ghHeaders(token), body: JSON.stringify({ ref: "main" }),
  });
}

/* attende il nuovo data.json (updated_at diverso dal precedente) — usa raw per freschezza */
async function waitForNewData(prev, tries = 28) {
  for (let i = 0; i < tries; i++) {
    await new Promise(r => setTimeout(r, 15000));
    try {
      rpDone(_rpPending, "ok"); _rpPending = rpLog(`Controllo pubblicazione dati (tentativo ${i + 1}/${tries})…`);
      const d = await fetchData();
      if (d.updated_at !== prev) {
        rpDone(_rpPending, "ok"); _rpPending = null;   // il tentativo che ha trovato i dati è riuscito
        rpLog("Nuovo data.json ricevuto — rendering della dashboard", "ok");
        DATA = d; renderAll(); return true;
      }
    } catch { rpDone(_rpPending, "fail"); _rpPending = null; rpLog(`Rete/CDN non pronti, riprovo (tentativo ${i + 1})`, "fail"); }
  }
  return false;
}

/* ---- Barra di avanzamento dell'aggiornamento (la pipeline è lenta: feedback continuo) ---- */
let _refreshTimer = null;
const REFRESH_STAGES = [
  [0,  "Avvio pipeline su GitHub Actions…"],
  [12, "Download prezzi e fondamentali (Yahoo Finance)…"],
  [32, "Elaborazione indici, macro e rotazione settoriale…"],
  [52, "Calcolo Sharpe Ratio, opzioni e SMC…"],
  [72, "Generazione e validazione data.json…"],
  [88, "Quasi pronto, attendo la pubblicazione…"],
];
const PRICE_STAGES = [
  [0,  "Scarico i prezzi live (Yahoo)…"],
  [45, "Aggiorno controvalori e P&L…"],
  [75, "Quasi pronto…"],
];
let _lastRpMsg = "";
/* v165 — ESITO ESPLICITO per ogni passo: il log elencava azioni senza dire quali fossero
   riuscite e quali no, e un fallimento (rete/CDN, tentativo a vuoto) si leggeva come una riga
   qualsiasi. Ora: ✓ riuscita · ✗ fallita · · in corso. */
function rpLog(msg, status = "info") {
  const box = document.getElementById("rp-log");
  if (!box) return;
  const line = document.createElement("div");
  line.className = `rp-log-line rp-${status}`;
  const mark = status === "ok" ? "✓" : status === "fail" ? "✗" : "·";
  line.textContent = `${new Date().toLocaleTimeString("it-IT")} ${mark} ${msg}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
  return line;
}
/* segna come CONCLUSA una riga di log già emessa (si tiene il riferimento all'elemento: cercarla
   per testo sbagliava bersaglio quando lo stesso messaggio compare più volte) */
let _rpPending = null;
function rpDone(el, esito = "ok") {
  if (!el || !el.classList || !el.classList.contains("rp-info")) return;
  el.classList.remove("rp-info"); el.classList.add(`rp-${esito}`);
  el.textContent = el.textContent.replace(" · ", esito === "ok" ? " ✓ " : " ✗ ");
}
function showRefreshProgress(est = 150000, stages = REFRESH_STAGES) {
  hideRefreshProgress();
  _lastRpMsg = "";
  const el = document.createElement("div");
  el.id = "refresh-progress";
  el.className = "refresh-progress";
  el.innerHTML = `
    <div class="rp-row"><span class="rp-spin"></span><span class="rp-msg" id="rp-msg">Avvio aggiornamento…</span><span class="rp-pct" id="rp-pct">0%</span></div>
    <div class="rp-track"><div class="rp-fill" id="rp-fill" style="width:0%"></div></div>
    <div class="rp-log" id="rp-log" aria-live="polite"></div>`;
  document.body.appendChild(el);
  const start = Date.now();
  _refreshTimer = setInterval(() => {
    const pct = Math.min(92, ((Date.now() - start) / est) * 92);
    const stage = [...stages].reverse().find(s => pct >= s[0]) || stages[0];
    setRefreshProgress(pct, stage[1]);
  }, 300);
}
function setRefreshProgress(pct, msg) {
  const f = document.getElementById("rp-fill"); if (f) f.style.width = pct.toFixed(0) + "%";
  const p = document.getElementById("rp-pct"); if (p) p.textContent = Math.round(pct) + "%";
  if (msg) {
    const m = document.getElementById("rp-msg"); if (m) m.textContent = msg;
    if (msg !== _lastRpMsg) {
      // v175 — passare allo step successivo significa che il PRECEDENTE è concluso: va spuntato.
      // Prima ogni riga restava neutra per tutta la durata e il CEO non vedeva mai un ✓ sulle
      // singole attività, solo sull'esito finale.
      rpDone(_rpPending, "ok");
      _lastRpMsg = msg; _rpPending = rpLog(msg);
    }
  }
}
function finishRefreshProgress(ok) {
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
  rpLog(ok ? "Pipeline completata: dati pubblicati e dashboard aggiornata"
           : "Pipeline NON confermata entro il tempo massimo: i dati potrebbero arrivare più tardi",
        ok ? "ok" : "fail");
  setRefreshProgress(100, ok ? "Aggiornamento completato ✓" : "Tempo scaduto — i dati potrebbero arrivare a breve");
  setTimeout(hideRefreshProgress, ok ? 1800 : 4000);
}
function hideRefreshProgress() {
  const el = document.getElementById("refresh-progress");
  if (el) el.remove();
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
}

/* Aggiorna: prezzi live all'istante + rigenerazione completa via workflow (col token,
   chiesto una sola volta). Senza token resta comunque utile (prezzi live + reload). */
function showRefreshDoneModal() {
  const ts = DATA?.updated_at ? new Date(DATA.updated_at).toLocaleString("it-IT") : "—";
  const existing = document.getElementById("refresh-done-modal");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.id = "refresh-done-modal";
  el.className = "refresh-done-backdrop";
  el.innerHTML = `<div class="refresh-done-box">
    <div class="refresh-done-icon">✓</div>
    <div class="refresh-done-title">Aggiornamento Completato</div>
    <div class="refresh-done-sub">Tutti i dati sono stati rigenerati con successo.<br><span class="muted">Aggiornato alle ${ts}</span></div>
    <button class="btn btn-primary" onclick="this.closest('#refresh-done-modal').remove()">OK</button>
  </div>`;
  el.addEventListener("click", e => { if (e.target === el) el.remove(); });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 8000);
}

// (il tasto rapido "⟳ Prezzi" è stato rimosso: resta un unico "⟳ Aggiorna tutto";
//  i prezzi live si aggiornano comunque da soli ogni 60 secondi)
async function refreshAll() {
  const btn = $("#btn-refresh");
  btn.classList.add("btn-refreshing");
  btn.textContent = "⏳ Aggiorno…";
  try {
    livePrices();
    const token = getToken();
    if (!token) { await loadData(false); toast("Prezzi aggiornati ✓ (token assente: niente rigenerazione completa)"); return; }
    const res = await dispatchWorkflow(token);
    if ([401, 403, 404].includes(res.status)) {
      localStorage.removeItem("gh_token");
      toast("Token senza permesso Actions — rimosso. Creane uno con Actions: read & write e riprova");
      return;
    }
    if (res.status !== 204) { rpLog(`Avvio pipeline RIFIUTATO da GitHub (HTTP ${res.status})`, "fail"); toast(`Errore avvio aggiornamento (HTTP ${res.status})`); return; }
    showRefreshProgress();
    rpLog("Workflow GitHub Actions avviato (rigenerazione completa della pipeline)", "ok");
    waitForNewData(DATA?.updated_at).then(ok => {
      finishRefreshProgress(ok);
      const b2 = $("#btn-refresh");
      const origTxt = "⟳ Aggiorna tutto";
      b2.classList.remove("btn-refreshing");
      if (ok) {
        b2.textContent = "✓ Aggiornato";
        b2.classList.add("btn-done");
        setTimeout(() => { b2.textContent = origTxt; b2.classList.remove("btn-done"); }, 6000);
        showRefreshDoneModal();
      } else {
        b2.textContent = origTxt;
      }
    });
  } catch (e) {
    console.error(e);
    toast("Errore durante l'aggiornamento");
  } finally {
    btn.classList.remove("btn-refreshing");
    btn.textContent = "⟳ Aggiorna tutto";
  }
}

/* ---------------- aggiungi/rimuovi titoli ---------------- */
const editMode = { portfolio: false, watchlist: false };

/* AUTO-TIMESTAMP SNAPSHOT (v113): salvare quantità/PMC/titoli del PORTAFOGLIO dalla UI
   significa aver appena riconciliato le posizioni col broker → la data di snapshot broker
   si aggiorna DA SOLA alla data odierna. Prima restava ferma e il banner "RICONCILIA COL
   BROKER" continuava a suonare a vuoto finché l'utente non editava holdings.json a mano.
   Le modifiche alla sola watchlist non toccano le posizioni → data invariata. */
function stampBrokerDate(cfg, section) {
  if (section !== "watchlist" && cfg && cfg.broker) {
    cfg.broker.as_of = new Date().toISOString().slice(0, 10);
    // Il timbro vale per le POSIZIONI (qty/PMC appena riconciliati a mano), NON per i
    // controvalori bval/bgain, che appartengono al VECCHIO snapshot: tenerli con la data
    // nuova stringerebbe la banda del drift (scala con √giorni) e il banner RICONCILIA
    // griderebbe al lupo su puro movimento di mercato (visto sul campo: RGTI -22% dal
    // 22/06 = mercato, non trade fantasma). Via i campi stale: tornano col prossimo
    // snapshot completo incollato dal broker in holdings.json.
    (cfg.portfolio || []).forEach(p => { delete p.bval; delete p.bgain; });
  }
  return cfg;
}

async function editHoldings(section, mutate) {
  let esito = false;                          // v250: l'esito deve tornare a chi chiama
  const token = getToken();
  if (!token) { toast("Serve un token GitHub (permessi Actions + Contents) per modificare le posizioni"); return false; }
  toast("Salvo la modifica…");
  try {
    // 1) leggi config/holdings.json con il suo SHA
    const path = "config/holdings.json";
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: ghHeaders(token), cache: "no-store" });
    if (!r.ok) {
      if ([401, 403].includes(r.status)) { localStorage.removeItem("gh_token"); toast("Token senza permesso Contents/Actions — rimosso. Creane uno con quei permessi e riprova"); }
      else if (r.status === 404) { toast("config/holdings.json non trovato sul repo"); }
      else toast(`Errore lettura config (HTTP ${r.status})`);
      return;
    }
    const file = await r.json();
    const cfg = JSON.parse(decodeURIComponent(escape(atob((file.content || "").replace(/\s/g, "")))));
    if (!mutate(cfg)) return false;           // mutate ritorna false se annullato/invalido
    stampBrokerDate(cfg, section);            // auto-timestamp snapshot (v113, vedi helper)
    // 2) scrivi il nuovo config
    const body = {
      message: `Aggiorna posizioni (${section})`,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(cfg, null, 1)))),
      sha: file.sha,
    };
    const put = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
      method: "PUT", headers: ghHeaders(token), body: JSON.stringify(body),
    });
    if (!put.ok) {
      /* ⚠ v250 — un 409 (conflitto di SHA) qui era MUTO per chi chiamava: la funzione tornava
         `undefined` e il chiamante non sapeva se avesse scritto. È così che quattro scritture
         in corsa sono fallite tutte senza che nulla lo dicesse. */
      toast(put.status === 409
        ? "Conflitto: il file è cambiato nel frattempo. Ricarica e riprova."
        : `Errore salvataggio (HTTP ${put.status})`);
      return false;
    }
    // 3) rigenera i dati in background (NON blocca la UI: la modifica è già visibile)
    dispatchWorkflow(token).catch(() => {});
    toast("Salvato ✓ — dati completi tra ~2-3 min");
    esito = true;
    waitForNewData(DATA?.updated_at).then(ok => { if (ok) toast("Dati aggiornati ✓"); });
  } catch (e) {
    console.error(e);
    toast("Errore durante il salvataggio della modifica");
    return false;
  }
  return esito;
}

/* ═══ v244 — LO STATO DEL PORTAFOGLIO SEGUE IL CEO FRA I DISPOSITIVI ═══════════════════════
   Il CEO: "quando cambio parametri, es. aggiornamento di acquisti o di cash, questi non si
   sincronizzano quando mi collego dalla stessa pagina da iPhone."
   Aveva ragione, ed era una svista di COMPLETEZZA: quando abbiamo costruito la sincronizzazione
   abbiamo coperto diario, ordine sezioni, override macro, testata e parametri di rischio — e ci
   siamo dimenticati proprio del portafoglio, cioè la cosa che cambia più spesso.
   Restavano in localStorage, quindi vive solo sul browser dove le scrivi:
     · cash_eur         la liquidità
     · manual_holdings  gli acquisti inseriti a mano
     · btp_override     quantità e prezzo di carico del BTP
   ⚠ Fusione PER CAMPO, non a blocco: ogni campo porta il suo istante. Se cambi la cassa sul Mac
   e le posizioni su iPhone, si tengono ENTRAMBE. Con un timestamp unico per tutto il blocco, la
   modifica più vecchia sparirebbe in silenzio — e una perdita silenziosa è peggio di un conflitto. */
const STATO_PTF_PATH = "config/portfolio_state.json";

function statoPortafoglioLocale() {
  const num = parseFloat(localStorage.getItem("cash_eur"));
  let hold = [], btp = null;
  try { hold = JSON.parse(localStorage.getItem("manual_holdings") || "[]"); } catch { /* corrotto */ }
  try { btp = JSON.parse(localStorage.getItem("btp_override") || "null"); } catch { /* corrotto */ }
  let ts = {};
  try { ts = JSON.parse(localStorage.getItem("stato_ptf_ts") || "{}"); } catch { /* corrotto */ }
  return {
    cash:     { v: isNaN(num) ? 0 : num, at: ts.cash || "" },
    holdings: { v: Array.isArray(hold) ? hold : [], at: ts.holdings || "" },
    btp:      { v: btp, at: ts.btp || "" },
  };
}

/* segna QUALE campo è cambiato e quando, poi salva e spedisce */
function salvaStatoPortafoglio(campo) {
  let ts = {};
  try { ts = JSON.parse(localStorage.getItem("stato_ptf_ts") || "{}"); } catch { /* corrotto */ }
  ts[campo] = new Date().toISOString();
  try { localStorage.setItem("stato_ptf_ts", JSON.stringify(ts)); } catch { /* quota */ }
  if (localStorage.getItem("gh_token")) pushStatoPortafoglioCloud(statoPortafoglioLocale());
  else toast("Salvato solo su questo browser: senza token GitHub non arriva su iPhone");
}

async function pushStatoPortafoglioCloud(s) {
  const token = localStorage.getItem("gh_token");
  if (!token) return;
  try {
    let sha;
    const g = await fetch(`https://api.github.com/repos/${REPO}/contents/${STATO_PTF_PATH}`, { headers: ghHeaders(token), cache: "no-store" });
    if (g.ok) sha = (await g.json()).sha;
    await fetch(`https://api.github.com/repos/${REPO}/contents/${STATO_PTF_PATH}`, {
      method: "PUT", headers: ghHeaders(token),
      body: JSON.stringify({ message: "Stato portafoglio (cassa, posizioni, BTP)", content: btoa(unescape(encodeURIComponent(JSON.stringify(s, null, 1)))), sha }),
    });
  } catch { /* offline: resta in locale, riparte al prossimo salvataggio */ }
}

/* rilegge dal repo e tiene, PER OGNI CAMPO, la versione più recente */
async function loadStatoPortafoglioCloud() {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${STATO_PTF_PATH}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return false;                       // 404 = non è mai stato salvato: nulla da fare
    const cloud = await r.json();
    if (!cloud || typeof cloud !== "object") return false;
    const loc = statoPortafoglioLocale();
    let ts = {}; try { ts = JSON.parse(localStorage.getItem("stato_ptf_ts") || "{}"); } catch { /* corrotto */ }
    let cambiato = false;
    // confronto esplicito campo per campo: più lungo di un ciclo, ma si legge cosa vince e perché
    if (cloud.cash && (cloud.cash.at || "") > (loc.cash.at || "")) {
      cashEur = parseFloat(cloud.cash.v) || 0;
      localStorage.setItem("cash_eur", cashEur);
      ts.cash = cloud.cash.at; cambiato = true;
    }
    if (cloud.holdings && (cloud.holdings.at || "") > (loc.holdings.at || "") && Array.isArray(cloud.holdings.v)) {
      localStorage.setItem("manual_holdings", JSON.stringify(cloud.holdings.v));
      ts.holdings = cloud.holdings.at; cambiato = true;
    }
    if (cloud.btp && (cloud.btp.at || "") > (loc.btp.at || "")) {
      if (cloud.btp.v) localStorage.setItem("btp_override", JSON.stringify(cloud.btp.v));
      else localStorage.removeItem("btp_override");
      ts.btp = cloud.btp.at; cambiato = true;
    }
    if (!cambiato) return false;
    try { localStorage.setItem("stato_ptf_ts", JSON.stringify(ts)); } catch { /* quota */ }
    /* ⚠ i dati sono già stati fusi in DATA quando questa arriva: va rifatta la fusione e
       ridisegnato tutto, altrimenti il valore nuovo resta invisibile fino a un reload manuale. */
    mergeManualHoldings();
    recomputeTotals();
    if (typeof renderKPI === "function") renderKPI();
    if (typeof renderTable === "function") renderTable();
    if (typeof renderAllocation === "function") renderAllocation();
    if (typeof renderCash === "function") renderCash();
    toast("Portafoglio sincronizzato da un altro dispositivo ✓");
    return true;
  } catch { return false; }
}

/* --- posizioni aggiunte a mano: persistite in localStorage così sopravvivono al reload
   anche senza token GitHub. Quando la pipeline le include in data.json, vengono ignorate. --- */
function loadManualHoldings() {
  try { return JSON.parse(localStorage.getItem("manual_holdings") || "[]"); }
  catch { return []; }
}
function saveManualHolding(h) {
  const arr = loadManualHoldings().filter(x => x.ticker !== h.ticker);
  arr.push(h);
  localStorage.setItem("manual_holdings", JSON.stringify(arr));
  salvaStatoPortafoglio("holdings");
}
function removeManualHolding(ticker) {
  localStorage.setItem("manual_holdings",
    JSON.stringify(loadManualHoldings().filter(x => x.ticker !== ticker)));
  salvaStatoPortafoglio("holdings");
}
/* unisce le posizioni manuali al DATA.portfolio appena caricato da data.json */
function mergeManualHoldings() {
  try {
    if (!DATA || !Array.isArray(DATA.portfolio)) return;
    // override BTP salvato a mano (qty/PMC) — persiste tra i reload senza toccare la pipeline
    try {
      const bo = JSON.parse(localStorage.getItem("btp_override") || "null");
      const btp = bo && DATA.portfolio.find(p => p.ticker === "BTP-V28");
      if (btp) {
        if (bo.qty > 0) btp.qty = bo.qty;
        if (bo.pmc > 0) btp.pmc = bo.pmc;
        btp.bval = null; btp.bgain = null;
        if (btp.price) { btp.value = btp.qty * btp.price / 100; btp.gain = btp.value - btp.qty * btp.pmc / 100; }
      }
    } catch { /* nessun override BTP */ }
    const manual = loadManualHoldings();
    if (!manual.length) return;
    let added = false;
    manual.forEach(h => {
      const ex = DATA.portfolio.find(p => p.ticker === h.ticker);
      if (ex) {
        // le mie correzioni manuali PREVALGONO sullo snapshot (a volte stale) del broker:
        // applico qty/PMC e azzero bval/bgain così il valore si calcola dal prezzo live reale.
        if (h.qty > 0) ex.qty = h.qty;
        if (h.pmc > 0) ex.pmc = h.pmc;
        ex.bval = null; ex.bgain = null;
        if (ex.price && ex.currency === "USD") {
          ex.value = ex.price * ex.qty;
          ex.gain = ex.value - ex.pmc * ex.qty;
          ex.gain_pct = Math.round((ex.value / (ex.pmc * ex.qty) - 1) * 10000) / 100;
        }
        added = true;
        return;
      }
      const row = placeholderRow(h.ticker, h.currency || "USD", { qty: h.qty, pmc: h.pmc, name: h.name || h.ticker });
      const btpIdx = DATA.portfolio.findIndex(p => p.ticker === "BTP-V28");
      if (btpIdx >= 0) DATA.portfolio.splice(btpIdx, 0, row); else DATA.portfolio.push(row);
      fillLivePrice(row, () => { recomputeTotals(); renderKPI(); renderTable(); renderAllocation(); });
      added = true;
    });
    if (added) recomputeTotals();
  } catch (e) { console.error("mergeManualHoldings", e); }
}

function addPortfolio() {
  const ticker = (window.prompt("Ticker da aggiungere al portafoglio (es. AAPL):") || "").trim().toUpperCase();
  if (!ticker) return;
  if ((DATA.portfolio || []).some(p => p.ticker === ticker)) { toast(`${ticker} è già in portafoglio`); return; }
  const qty = parseFloat(window.prompt(`Quantità di ${ticker}:`) || "");
  const pmc = parseFloat(window.prompt(`Prezzo medio di carico (PMC) di ${ticker} in USD:`) || "");
  if (!(qty > 0) || !(pmc > 0)) { toast("Quantità/PMC non validi"); return; }
  // aggiunta ottimistica: la riga compare subito, i dati completi arrivano col workflow
  const row = placeholderRow(ticker, "USD", { qty, pmc });
  DATA.portfolio.splice(DATA.portfolio.length - 1, 0, row);   // prima del BTP
  renderTable(); recomputeTotals(); renderKPI(); renderAllocation();
  fillLivePrice(row, () => { recomputeTotals(); renderKPI(); renderTable(); renderAllocation(); });
  // persistenza locale (sopravvive al reload anche senza token)
  saveManualHolding({ ticker, name: ticker, qty, pmc, currency: "USD" });
  toast(`${ticker} aggiunto al portafoglio ✓`);
  // persistenza sul repo (se c'è un token): la pipeline rigenera i dati completi
  editHoldings("portfolio", cfg => {
    cfg.portfolio = cfg.portfolio || [];
    if (cfg.portfolio.some(p => p.ticker === ticker)) return false;
    cfg.portfolio.push({ ticker, name: ticker, qty, pmc });
    return true;
  });
}

/* Modale "Modifica valori": edita qty + PMC di ogni posizione e la liquidità in un colpo solo.
   Salva localmente (sopravvive al reload) e, se c'è un token, persiste su config/holdings.json. */
function openEditPortfolio() {
  const rows = (DATA.portfolio || []);   // include anche il BTP (modificabile)
  const body = `
    <div class="info-line muted" style="font-size:11.5px;margin-bottom:8px">Modifica quantità e PMC di ogni posizione (BTP incluso) e la liquidità disponibile. Patrimonio, allocazione e KPI si aggiornano al salvataggio.</div>
    <div class="edp-row edp-head"><span>Titolo</span><span>Quantità</span><span>PMC</span></div>
    ${rows.map(r => `<div class="edp-row" data-edp="${r.ticker}">
      <span class="edp-tk">${esc(r.name)} <span class="tk">${r.ticker}</span></span>
      <input type="number" class="edp-qty" data-tk="${r.ticker}" value="${r.qty ?? ""}" step="any" min="0">
      <input type="number" class="edp-pmc" data-tk="${r.ticker}" value="${r.pmc ?? ""}" step="any" min="0">
    </div>`).join("")}
    <div class="edp-row edp-cash"><span>Liquidità disponibile (€)</span><input type="number" id="edp-cash" value="${cashEur || ""}" step="any" min="0"><span></span></div>
    <div class="edp-actions"><button class="btn btn-primary" id="edp-save">Salva modifiche</button>
      <span class="muted" style="font-size:11px">le variazioni sono immediate; con token GitHub vengono anche salvate sul repo</span></div>`;
  openInfoModal("Modifica valori portafoglio", body);
  $("#edp-save")?.addEventListener("click", () => {
    let changed = false;
    document.querySelectorAll(".edp-row[data-edp]").forEach(div => {
      const tk = div.dataset.edp;
      const r = DATA.portfolio.find(x => x.ticker === tk);
      if (!r) return;
      const nq = parseFloat(div.querySelector(".edp-qty").value);
      const np = parseFloat(div.querySelector(".edp-pmc").value);
      if (nq > 0 && nq !== r.qty) { r.qty = nq; changed = true; }
      if (np > 0 && np !== r.pmc) { r.pmc = np; changed = true; }
      // ricalcola valore/guadagno dal prezzo corrente (no bval snapshot: ora è una posizione editata a mano)
      if (r.price && r.currency === "USD") {
        r.bval = null; r.bgain = null;
        r.value = r.price * r.qty;
        r.gain = r.value - r.pmc * r.qty;
        r.gain_pct = Math.round((r.value / (r.pmc * r.qty) - 1) * 10000) / 100;
      } else if (r.ticker === "BTP-V28") {                   // BTP: valore = nominale × prezzo/100
        r.bval = null; r.bgain = null;
        if (r.price) {
          r.value = r.qty * r.price / 100;
          r.gain = r.value - r.qty * r.pmc / 100;
          r.gain_pct = r.pmc ? Math.round((r.price / r.pmc - 1) * 10000) / 100 : 0;
        }
        localStorage.setItem("btp_override", JSON.stringify({ qty: r.qty, pmc: r.pmc }));   // persiste tra i reload
        salvaStatoPortafoglio("btp");
      }
      if (r.ticker !== "BTP-V28") saveManualHolding({ ticker: tk, name: r.name, qty: r.qty, pmc: r.pmc, currency: r.currency || "USD" });
    });
    const nc = parseFloat($("#edp-cash").value) || 0;
    if (nc !== cashEur) { cashEur = nc; localStorage.setItem("cash_eur", cashEur); changed = true; salvaStatoPortafoglio("cash"); }
    if (changed) salvaStatoPortafoglio("holdings");   // v244: posizioni e BTP seguono il CEO fra i device
    recomputeTotals(); renderKPI(); renderTable(); renderAllocation(); renderCash();
    closeChartModal();
    toast(changed ? "Portafoglio aggiornato ✓" : "Nessuna modifica");
    if (changed) {
      // persistenza sul repo (best-effort, se c'è un token)
      editHoldings("portfolio", cfg => {
        cfg.portfolio = (cfg.portfolio || []).map(p => {
          const r = DATA.portfolio.find(x => x.ticker === p.ticker);
          return r ? { ...p, qty: r.qty, pmc: r.pmc } : p;
        });
        return true;
      });
    }
  });
}

function addWatchlist() {
  const ticker = (window.prompt("Ticker da aggiungere alla watchlist (es. AAPL, ^GSPC, BTC-USD):") || "").trim().toUpperCase();
  if (!ticker) return;
  if ((DATA.watchlist || []).some(p => p.ticker === ticker)) { toast(`${ticker} è già in watchlist`); return; }
  const currency = ticker.startsWith("^") ? "PTS" : "USD";
  const row = placeholderRow(ticker, currency, {});
  (DATA.watchlist = DATA.watchlist || []).push(row);
  renderWatchlist(); fillLivePrice(row, renderWatchlist);
  toast(`${ticker} aggiunto ✓`);
  editHoldings("watchlist", cfg => {
    cfg.watchlist = cfg.watchlist || [];
    if (cfg.watchlist.some(p => p.ticker === ticker)) return false;
    cfg.watchlist.push({ ticker, name: null, currency });
    return true;
  });
}

// riga segnaposto finché il workflow non porta i dati tecnici completi
function placeholderRow(ticker, currency, extra) {
  // valore provvisorio = costo (PMC × qtà): rende l'allocazione subito congrua,
  // poi fillLivePrice lo raffina col prezzo reale. Evita posizioni "a 0" se il quote fallisce.
  const provValue = (currency === "USD" && extra && extra.qty && extra.pmc) ? extra.qty * extra.pmc : 0;
  return {
    ticker, name: ticker, currency, price: extra && extra.pmc || null, change_pct: null,
    value: provValue, gain: 0, gain_pct: null, pe: null, eps: null, beta: null,
    ath: null, ath_dist_pct: null, support: null, resistance: null, rsi: null,
    volume: null, vol_ratio: null, signal: "in caricamento…", signal_class: "neutral",
    sparks: {}, tech_by_range: {}, rating: null, prepost: null, stats: null,
    earnings_date: null, fin_health: null, sector: "—", _loading: true, ...extra,
  };
}

function fillLivePrice(row, after) {
  fetchQuote(row.ticker).then(q => {
    if (q) {
      row.price = Math.round(q.price * 100) / 100;
      row.change_pct = Math.round((q.price / q.prev - 1) * 10000) / 100;
      if (row.currency === "USD" && row.qty) {
        row.value = row.price * row.qty;
        row.gain = row.value - row.pmc * row.qty;
        row.gain_pct = Math.round((row.value / (row.pmc * row.qty) - 1) * 10000) / 100;
      }
    }
    row._loading = false;
    if (after) after();   // anche se il quote fallisce: l'allocazione resta congrua col valore provvisorio
  }).catch(() => { row._loading = false; if (after) after(); });
}

function removeHolding(section, ticker) {
  if (!window.confirm(`Rimuovere ${ticker} da ${section === "portfolio" ? "portafoglio" : "watchlist"}?`)) return;
  // rimozione ottimistica immediata
  DATA[section] = (DATA[section] || []).filter(p => p.ticker !== ticker);
  if (section === "portfolio") { removeManualHolding(ticker); recomputeTotals(); renderKPI(); renderTable(); renderAllocation(); }
  else renderWatchlist();
  toast(`${ticker} rimosso ✓`);
  editHoldings(section, cfg => {
    const arr = cfg[section] || [];
    const n = arr.length;
    cfg[section] = arr.filter(p => p.ticker !== ticker);
    return cfg[section].length < n;
  });
}

/* ---------------- prezzi live lato client (CORS proxy → Yahoo) ---------------- */
const CORS_PROXIES = [
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://thingproxy.freeboard.io/fetch/${u}`,
];

async function fetchQuote(symbol) {
  const yurl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  for (const make of CORS_PROXIES) {
    try {
      const r = await fetch(make(yurl), { cache: "no-store" });
      if (!r.ok) continue;
      const j = await r.json();
      const m = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
      if (m && m.regularMarketPrice) {
        return { price: +m.regularMarketPrice, prev: +(m.chartPreviousClose ?? m.previousClose ?? m.regularMarketPrice) };
      }
    } catch { /* prova il proxy successivo */ }
  }
  return null;
}

let cashEur = parseFloat(localStorage.getItem("cash_eur")) || 0;

function recomputeTotals() {
  const eurusd = DATA.eurusd || 1.08;
  // valore e guadagno per posizione in EUR: usa lo snapshot REALE del broker (bval/bgain)
  // se presente, altrimenti calcola dai prezzi live. r.val_eur/r.gain_eur = verità mostrata.
  let valEur = 0, costEur = 0, stockGainEur = 0, btpGainEur = 0;
  DATA.portfolio.forEach(r => {
    let v, g;
    const hasLive = r.price != null && r.qty;
    // PRIORITÀ AL VIVO: prezzo live × quantità (più fresco dello snapshot broker, spesso datato).
    // Fallback allo snapshot bval/bgain solo se manca il prezzo live.
    if (r.currency === "EUR") { v = r.value || 0; g = r.gain || 0; }                       // BTP (già in EUR)
    else if (hasLive) { v = (r.price * r.qty) / eurusd; g = ((r.price - r.pmc) * r.qty) / eurusd; }
    else if (r.bval != null) { v = r.bval; g = r.bgain || 0; }
    else { v = (r.value || 0) / eurusd; g = (r.gain || 0) / eurusd; }
    r.val_eur = v; r.gain_eur = g;
    valEur += v; costEur += (v - g);
    if (r.ticker === "BTP-V28") btpGainEur += g; else stockGainEur += g;
  });
  const investedEur = valEur;                       // controvalore investimenti (liquidità esclusa)
  const eurGain = stockGainEur + btpGainEur;
  const tax = 0.26 * Math.max(0, stockGainEur) + 0.125 * Math.max(0, btpGainEur);
  // totali in USD (per la riga "azioni $…" della tabella)
  const eq = DATA.portfolio.filter(r => r.currency === "USD");
  const usdValue = eq.reduce((s, r) => s + (r.value || 0), 0);
  const usdCost = eq.reduce((s, r) => s + r.pmc * r.qty, 0);
  Object.assign(DATA.totals, {
    usd_value: usdValue, usd_gain: usdValue - usdCost, usd_gain_pct: usdCost ? (usdValue / usdCost - 1) * 100 : 0,
    eur_value: investedEur + cashEur, eur_invested: investedEur, eur_cost: costEur, cash: cashEur,
    eur_gain: eurGain, eur_gain_pct: costEur ? eurGain / costEur * 100 : 0,
    eur_stock_gain: stockGainEur, eur_btp_gain: btpGainEur,
    tax_est: tax, eur_gain_net: eurGain - tax,
    // OFFLOADING per l'LLM: budget realmente spendibile = cassa − Expected Shortfall 95%
    // (la quota pari all'ES è tail-risk INVIOLABILE). Mai sotto zero. ES storico se disponibile.
    budget_operativo_spendibile: Math.max(0, cashEur - (DATA.totals?.es95_hist_eur ?? DATA.totals?.es95_1d_eur ?? 0)),
  });
  DATA.allocation = DATA.portfolio.map(r => ({
    ticker: r.ticker, name: r.name, sector: r.sector || "Altro", value_eur: r.val_eur,
    gain_eur: r.gain_eur ?? null,
    gain_pct: (r.gain_eur != null && r.val_eur != null && (r.val_eur - r.gain_eur) > 0)
      ? Math.round(r.gain_eur / (r.val_eur - r.gain_eur) * 1000) / 10 : null,
  }));
  if (cashEur > 0) DATA.allocation.push({ ticker: "CASH", name: "Liquidità", sector: "Liquidità", value_eur: cashEur });
  DATA.allocation.sort((a, b) => b.value_eur - a.value_eur);
}

async function livePrices() {
  if (!DATA) return;
  const syms = [...new Set([
    ...DATA.portfolio.filter(r => r.ticker !== "BTP-V28").map(r => r.ticker),
    ...(DATA.watchlist || []).map(r => r.ticker),
  ])];
  const res = await Promise.allSettled(syms.map(s => fetchQuote(s).then(q => [s, q])));
  const map = {}; let any = false;
  res.forEach(x => { if (x.status === "fulfilled" && x.value[1]) { map[x.value[0]] = x.value[1]; any = true; } });
  if (!any) return;
  const upd = (r) => {
    const q = map[r.ticker]; if (!q) return;
    r.price = Math.round(q.price * 100) / 100;
    r.change_pct = Math.round((q.price / q.prev - 1) * 10000) / 100;
    if (r.currency === "USD" && r.qty) {
      r.value = r.price * r.qty;
      r.gain = r.value - r.pmc * r.qty;
      r.gain_pct = Math.round((r.value / (r.pmc * r.qty) - 1) * 10000) / 100;
    }
  };
  DATA.portfolio.forEach(upd);
  (DATA.watchlist || []).forEach(upd);
  recomputeTotals();
  refreshShockClient();         // ricalcola lo shock dai prezzi live (KOSPI/futures) — coglie crolli/recuperi
  renderKPI(); renderTable(); renderWatchlist(); renderAllocation(); renderShockAlert();
  const el = $("#live-badge");
  if (el) el.textContent = `Prezzi live: ${new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

function renderAll() {
  const d = new Date(DATA.updated_at);
  const at = $("#updated-at");
  at.textContent = d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  // badge "dati vecchi": se il workflow non rigenera da >8 ore, avviso (la pipeline gira più volte al dì)
  const ageH = (Date.now() - d.getTime()) / 3600000;
  const upd = at.closest(".upd-item");
  if (upd) {
    upd.classList.toggle("stale", ageH > 8);
    at.title = ageH > 8 ? `Dati di ${Math.round(ageH)} ore fa — premi "↻ Rigenera tutto" per aggiornarli` : "";
    upd.querySelector(".stale-tag")?.remove();
    if (ageH > 8) { const s = document.createElement("span"); s.className = "stale-tag"; s.textContent = ` ⚠ ${Math.round(ageH)}h fa`; at.after(s); }
  }
  recomputeTotals();            // include la liquidità nei totali/allocazione
  renderCash();
  renderKPI();
  renderAllocation();
  renderStruttura();            // v205 — i grafici della struttura del libro
  renderMacroGrafici();         // v206 — rotazione, stress, leva e stagionalità
  renderEarnings();
  renderEarningsAlert();
  renderDivergenzaDiario();   // v245: diario vs portafoglio — prima della riconciliazione
  renderReconcileAlert();
  refreshShockClient();         // allinea il banner shock ai prezzi live già presenti
  renderShockAlert();
  renderDataQualityAlert();
  renderTable();
  renderWatchlist();
  renderPortfolioHealth();
  renderMiniCards();
  recordPolymarket();   // accumula lo storico Polymarket (un punto/giorno) per la derivata Δ7g
  renderNews();
  renderBtpInfo();
  // NON ricostruire la tabella vendite mentre il popup è aperto: l'auto-refresh (ogni 5 min)
  // azzerava gli input e chiudeva la tastiera mentre l'utente stava scrivendo
  if ($("#sell-modal")?.hidden !== false) renderSellCalc();
  pmcInit();
}

/* banner di alert: trimestrali entro 7 giorni (rischio binario) con Implied Move */
function renderEarningsAlert() {
  const box = $("#earnings-alert");
  if (!box) return;
  const all = [...DATA.portfolio, ...(DATA.watchlist || [])];
  const items = all.filter(r => r.earnings_date)
    .map(r => ({ ...r, days: giorniAllaTrimestrale(r.earnings_date) }))
    .filter(r => r.days >= 0 && r.days <= 7)
    .sort((a, b) => a.days - b.days);
  if (!items.length) { box.hidden = true; box.innerHTML = ""; box.className = ""; return; }
  const ptf = new Set(DATA.portfolio.map(x => x.ticker));
  box.hidden = false;
  box.className = "earnings-alert";
  box.innerHTML = `<span class="ea-lab">⚠ Trimestrali entro 7 giorni</span>` + items.map(r => {
    const im = typeof impliedMoveForEarnings === "function" ? impliedMoveForEarnings(r) : null;
    const when = r.days <= 0 ? "oggi" : r.days === 1 ? "domani" : `tra ${r.days}gg`;
    return `<span class="ea-chip${ptf.has(r.ticker) ? "" : " ea-wl"}" title="${esc(r.name)}${ptf.has(r.ticker) ? "" : " (watchlist)"}">${r.ticker} · ${when}${im != null ? ` · ±${im}%` : ""}</span>`;
  }).join("");
}

/* riconciliazione col broker: niente API, quindi qty/PMC/bval sono aggiornati A MANO.
   Due segnali di disallineamento (il buco più pericoloso: un trade eseguito ma non
   riportato → il motore ragiona su un portafoglio che non esiste più):
   1) snapshot broker VECCHIO (>14 gg dalla data as_of);
   2) incoerenza per posizione: controvalore ricalcolato (prezzo live × qtà, in €) che
      diverge >20% dal bval del broker — quasi sempre qty/PMC non allineati o bval stantio
      (la soglia larga assorbe il drift di mercato di un paio di settimane). */
function reconcileState() {
  const b = DATA?.broker || {};
  const out = { staleDays: null, mismatches: [] };
  if (b.as_of) {
    const d = Math.floor((Date.now() - new Date(b.as_of + "T00:00:00")) / 86400000);
    if (d >= 0) out.staleDays = d;
  }
  (DATA?.portfolio || []).forEach(r => {
    if (r.val_eur == null || r.bval == null || r.bval <= 0) return;
    const dev = r.val_eur / r.bval - 1;
    // soglia volatility-aware: banda ~2σ del titolo sull'età dello snapshot (σ_d ≈ ATR%/1,4),
    // col floor al 20%. Senza: i nomi ultra-volatili (MSTR, IPO) sforerebbero per puro
    // drift di mercato e il banner griderebbe al lupo.
    const days = Math.max(out.staleDays ?? 7, 1);
    const sigmaD = r.atr_pct != null ? r.atr_pct / 100 / 1.4 : 0.025;
    const thr = Math.max(0.20, 2 * sigmaD * Math.sqrt(days));
    if (Math.abs(dev) > thr) out.mismatches.push({ tk: r.ticker, dev: Math.round(dev * 100) });
  });
  out.needed = (out.staleDays != null && out.staleDays > 14) || out.mismatches.length > 0;
  return out;
}


/* DATA ASSERTIONS lato client (post-incidente margin debt congelato a $622 mld Z.1):
   legge data_quality dalla pipeline e, se assente (JSON vecchio), ricalcola i check
   critici in locale. Un dato DATATO o INAFFIDABILE deve URLARE: banner in dashboard
   + flag giganti nel prompt — mai più degradi silenziosi. */
function validateMacroData() {
  const dq = DATA?.data_quality;
  const m = DATA?.macro || {};
  const out = { bad: [], stale: [], overrides: [], flags: {} };   // flags[key] = testo per il prompt
  const overridden = (key) => {
    if (key === "forward_pe") return m.forward_pe?.manual_override && m.forward_pe;
    if (key === "sp500_pe") return m.sp500_pe?.manual_override && m.sp500_pe;
    if (key === "margin_debt") return m.margin_debt?.manual_override && m.margin_debt;
    if (key === "vix") return m.vix?.manual_override && m.vix;
    const ind = (m.indicators || []).find(i => i.key === key);
    return ind?.manual_override ? ind : null;
  };
  const classify = (key, status, note) => {
    const ovNode = overridden(key);
    if (ovNode) {   // corretto a mano: allarme SPENTO, provenienza dichiarata nel prompt
      out.overrides.push({ key, date: (ovNode.override_date || "").slice(0, 10) });
      out.flags[key] = `[MANUAL_OVERRIDE — valore inserito dall'utente il ${(ovNode.override_date || "").slice(0, 10) || "n.d."}]`;
      return;
    }
    if (status === "implausible" || status === "unreliable" || status === "missing") {
      out.bad.push({ key, status, note });
      out.flags[key] = `[!!! DATATO / UNRELIABLE !!!${note ? " " + note : ""}]`;
    } else if (status === "stale" && !out.flags[key]) {   // mai degradare un flag UNRELIABLE a semplice LAG
      out.stale.push({ key, note });
      out.flags[key] = "[LAG TEMPORALE RILEVATO — double-check via web PRIMA di usare questo dato]";
    }
  };
  if (dq && Array.isArray(dq.checks)) {
    dq.checks.forEach(c => classify(c.key, c.status, c.note || ""));
  } else {
    // fallback client-side minimale su JSON senza data_quality (pre-v97)
    const md = m.margin_debt;
    if (md && (md.unreliable || !/FINRA/.test(md.series || "") || (md.value || 0) < 800000)) {
      classify("margin_debt", "unreliable", `serie ${md?.series || "?"} — non è il dato FINRA reale (~$1,4T nel 2026)`);
    }
    const ageD = (ds) => ds ? Math.floor((Date.now() - new Date(ds).getTime()) / 86400000) : null;
    if (md && ageD(md.date) > 90) classify("margin_debt", "stale", "");
    if (m.vix && m.vix.value != null && !(m.vix.value >= 5 && m.vix.value <= 150)) classify("vix", "implausible", `VIX ${m.vix.value}`);
  }
  out.ok = !out.bad.length && !out.stale.length;   // gli override attivi NON sono allarme
  return out;
}

/* ---------------- MANUAL OVERRIDE dei dati macro flaggati ----------------
   L'utente può correggere a mano un dato missing/stale/unreliable dal popup del banner.
   Regole di onestà: (1) l'override si applica SOLO finché la pipeline resta rotta su quel
   dato — quando torna un dato vero e fresco, l'override decade automaticamente;
   (2) ogni valore corretto a mano è marcato manual_override e nel prompt appare come
   [MANUAL_OVERRIDE] con la data d'inserimento: mai spacciato per dato di fonte. */
const OVERRIDE_PATH = "config/macro_overrides.json";
function loadOverrides() {
  try { return JSON.parse(localStorage.getItem("macro_overrides") || "{}"); } catch { return {}; }
}
function saveOverrides(o) {
  localStorage.setItem("macro_overrides", JSON.stringify(o));
  pushOverridesCloud(o);   // sync su GitHub se c'è token (stesso pattern del diario)
}
async function pushOverridesCloud(o) {
  const token = localStorage.getItem("gh_token");
  if (!token) return;
  try {
    let sha;
    const g = await fetch(`https://api.github.com/repos/${REPO}/contents/${OVERRIDE_PATH}`, { headers: ghHeaders(token), cache: "no-store" });
    if (g.ok) sha = (await g.json()).sha;
    await fetch(`https://api.github.com/repos/${REPO}/contents/${OVERRIDE_PATH}`, {
      method: "PUT", headers: ghHeaders(token),
      body: JSON.stringify({ message: "Override manuale dati macro", content: btoa(unescape(encodeURIComponent(JSON.stringify(o, null, 1)))), sha }),
    });
  } catch { /* offline: resta in locale */ }
}
async function loadOverridesCloud() {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${OVERRIDE_PATH}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const cloud = await r.json();
    if (cloud && typeof cloud === "object") {
      const local = loadOverrides();
      // vince il più recente per chiave
      Object.entries(cloud).forEach(([k, v]) => {
        if (!local[k] || (v.savedAt || "") > (local[k].savedAt || "")) local[k] = v;
      });
      localStorage.setItem("macro_overrides", JSON.stringify(local));
    }
  } catch { /* nessun override remoto */ }
}

/* stato pipeline per chiave (dai check data_quality), PRIMA degli override */
function dqStatusOf(key) {
  const c = (DATA?.data_quality?.checks || []).find(x => x.key === key);
  return c ? c.status : null;
}

/* applica gli override ai dati in memoria; ritorna le chiavi applicate */
function applyMacroOverrides() {
  const m = DATA?.macro;
  if (!m) return [];
  const ov = loadOverrides();
  const applied = [];
  let changed = false;
  Object.entries(ov).forEach(([key, o]) => {
    const st = dqStatusOf(key);
    const broken = st == null || ["missing", "unreliable", "implausible", "stale"].includes(st);
    if (!broken) { delete ov[key]; changed = true; return; }   // pipeline guarita → override decade
    const v = parseFloat(o.value);
    if (!(v > 0)) return;
    if (key === "forward_pe") {
      m.forward_pe = { value: v, avg_hist: 16.5,
        label: v > 22 ? "Estremo" : v > 18 ? "Elevato" : v > 14 ? "Normale" : "Conveniente",
        manual_override: true, override_date: o.savedAt };
    } else if (key === "sp500_pe") {
      m.sp500_pe = Object.assign(m.sp500_pe || { history: [] }, {
        current: v, label: v > 25 ? "Sopravvalutazione" : v > 20 ? "Valutazione elevata" : "Valutazione normale",
        manual_override: true, override_date: o.savedAt });
    } else if (key === "margin_debt") {
      const peak = Math.max(v, 935904, m.margin_debt?.peak || 0);
      m.margin_debt = Object.assign(m.margin_debt || {}, {
        value: v, peak, pct_of_peak: Math.round(v / peak * 1000) / 10,
        date: o.date || m.margin_debt?.date, series: "FINRA debit balances (override manuale)",
        manual_override: true, override_date: o.savedAt });
      delete m.margin_debt.unreliable;
    } else if (key === "vix") {
      m.vix = Object.assign(m.vix || {}, { value: v, manual_override: true, override_date: o.savedAt });
    } else {   // indicatori (pmi, cpi, pce, gdp, nfp...)
      const ind = (m.indicators || []).find(i => i.key === key);
      if (ind) { ind.value = String(o.value); ind.manual_override = true; ind.override_date = o.savedAt; ind.date = (o.savedAt || "").slice(0, 10) || ind.date; }
    }
    applied.push(key);
  });
  if (changed) saveOverrides(ov);
  return applied;
}

/* popup di correzione: input per ogni dato flaggato, salva → override + allarme spento */
function openDataQualityModal() {
  const v = validateMacroData();
  const items = [...v.bad.map(b => ({ ...b, sev: "bad" })), ...v.stale.map(s2 => ({ ...s2, status: "stale", sev: "stale" }))];
  const ov = loadOverrides();
  if (!items.length && !Object.keys(ov).length) { toast("Nessun dato macro da correggere ✓"); return; }
  const HINTS = {
    forward_pe: "Forward P/E S&P 500 (es. 21.7 — wsj.com/market-data/stocks/peyields)",
    sp500_pe: "P/E trailing S&P 500 (es. 25.4)",
    margin_debt: "Margin Debt FINRA in $ MILIONI (es. 1415557 = $1,42T — finra.org margin statistics)",
    umich: "Fiducia consumatori UMich (es. 53.3 — NON è l'ISM PMI)", vix: "VIX spot", cpi: "CPI YoY % (es. 4.3)", pce: "PCE YoY %",
  };
  const rows = items.map(it => `
    <div class="edp-row"><span class="edp-tk"><b>${esc(it.key)}</b> <span class="muted">(${esc(it.status)})</span><br>
      <span class="muted" style="font-size:10px">${esc(HINTS[it.key] || "valore numerico")}</span></span>
      <input type="number" step="any" inputmode="decimal" id="ov-${esc(it.key)}" placeholder="valore corretto" value="${ov[it.key]?.value ?? ""}">
      ${it.key === "margin_debt" ? `<input type="month" id="ov-date-${esc(it.key)}" value="${(ov[it.key]?.date || new Date().toISOString().slice(0, 7))}">` : "<span></span>"}
    </div>`).join("");
  const active = Object.keys(ov).length ? `<div class="info-line muted" style="font-size:11px;margin-top:8px">Override attivi: ${Object.entries(ov).map(([k, o]) => `${k}=${o.value}`).join(", ")} — decadono da soli quando la pipeline torna a fornire il dato vero.</div>` : "";
  openInfoModal("Correggi dati macro (override manuale)",
    `<div class="info-line" style="margin-bottom:8px">Inserisci i valori corretti per i dati che la pipeline non riesce a fornire. Verranno usati da dashboard e prompt AI marcati <b>[MANUAL_OVERRIDE]</b> con la data d'inserimento, e <b>decadranno automaticamente</b> quando la fonte tornerà a funzionare.</div>
     ${rows || '<div class="muted">Nessun dato flaggato al momento.</div>'}${active}
     <div class="edp-actions"><button class="btn btn-primary btn-sm" id="ov-save">Salva override</button>
     <button class="btn btn-ghost btn-sm" id="ov-clear">Rimuovi tutti</button></div>`);
  $("#ov-save")?.addEventListener("click", () => {
    const o = loadOverrides();
    const now = new Date().toISOString();
    items.forEach(it => {
      const inp = $(`#ov-${it.key}`);
      const val = parseFloat(inp?.value);
      if (val > 0) {
        o[it.key] = { value: val, savedAt: now };
        const dt = $(`#ov-date-${it.key}`);
        if (dt && dt.value) o[it.key].date = dt.value + "-01";
      }
    });
    saveOverrides(o);
    applyMacroOverrides();
    renderAll();
    closeChartModal();
    toast("Override salvati — allarme spento per i dati corretti ✓");
  });
  $("#ov-clear")?.addEventListener("click", () => {
    saveOverrides({});
    toast("Override rimossi — al prossimo caricamento tornano i dati (e gli allarmi) della pipeline");
    closeChartModal();
  });
}

/* SHOCK ALERT CLIENT-SIDE (v132): la pipeline calcola lo shock solo ai suoi run, ma i prezzi di
   KOSPI/futures si aggiornano LIVE nel browser ogni 60s → un crollo (o un RECUPERO) tra un run e
   l'altro non si rifletteva nel banner. Qui ricalcolo dai prezzi live: la variazione live di
   ^KS11 (q.price/q.prev, già sessione-corrente per costruzione) rimpiazza il valore di pipeline;
   i futures restano quelli di pipeline (non aggiornati client-side). Gate: solo con Wall Street
   REGOLARE chiusa (lo shock è un fenomeno overnight/pre-apertura). */
/* v161 — FONTE DI VERITÀ UNICA sulla fase di seduta: derivata da usSessionInfo invece di
   ri-implementare la stessa finestra oraria. Prima le due funzioni erano coerenti solo "per
   costruzione" (stesse costanti copiate): qualunque ritocco a una — festività, DST, orari
   ridotti — le avrebbe fatte divergere, e il payload avrebbe potuto dire WEEKEND in una riga
   e comportarsi da mercato aperto in un'altra. Ora la divergenza è impossibile. */
function usRegularSessionOpen(now = new Date()) {
  return usSessionInfo(now).phase === "regular";
}
/* FASE DELLA SEDUTA USA (v149): il payload deve sapere "che ora è" — un'analisi delle 07:18
   italiane (notte USA) ragiona su anticipatori (KOSPI/futures/esteso) e propone ordini per
   l'APERTURA; una delle 15:00 ET ragiona sui prezzi live. Senza questa riga l'LLM ignorava
   il KOSPI +4,5% live in pre-apertura (visto sul run del 21/07). Festività USA non considerate
   (approssimazione dichiarata). */
function usSessionInfo(now = new Date()) {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay(), mins = et.getHours() * 60 + et.getMinutes();
  const weekend = day === 0 || day === 6;
  const phase = weekend ? "weekend"
    : mins >= 240 && mins < 570 ? "pre-market"
    : mins >= 570 && mins < 960 ? "regular"
    : mins >= 960 && mins < 1200 ? "after-hours"
    : "notte";
  let minsToOpen = null;
  if (!weekend && mins < 570) minsToOpen = 570 - mins;
  else {
    let ahead = 1;
    while ([0, 6].includes((day + ahead) % 7)) ahead++;
    minsToOpen = ahead * 1440 - mins + 570;
  }
  return { phase, minsToOpen, etHHMM: `${String(et.getHours()).padStart(2, "0")}:${String(et.getMinutes()).padStart(2, "0")}` };
}
function sessionContextLine() {
  const s = usSessionInfo();
  const hrs = Math.round(s.minsToOpen / 60 * 10) / 10;
  // anticipatori inline (STEP 0 material): KOSPI live, futures pipeline, BTC — i dati che
  // l'LLM deve pesare PRIMA della campana, serviti dove li legge per primi
  const wl = DATA.watchlist || [];
  const ks = wl.find(r => r.ticker === "^KS11"), btc = wl.find(r => r.ticker === "BTC-USD");
  const fut = (DATA.macro || {}).futures || {};
  // v158 — un anticipatore vale solo se è FRESCO. Nel weekend anche l'Asia è chiusa: il KOSPI è la
  // candela di venerdì, già incorporata nella chiusura USA di venerdì. Spacciarlo per "anticipatore"
  // spingeva a leggere due volte lo stesso movimento (e ha già prodotto un allarme shock fantasma).
  const dmy = (v) => { const t = new Date(String(v).slice(0, 10)); return isNaN(t) ? "" : ` [chiusura del ${String(t.getUTCDate()).padStart(2, "0")}/${String(t.getUTCMonth() + 1).padStart(2, "0")}]`; };
  const lead = [
    // v190 — TRE stati, non due. Il v182 ne distingueva solo "live" e "borsa ferma", e quando
    // Seoul apriva mentre lo snapshot era ancora quello di ieri l'etichetta diceva "borsa ferma"
    // nella stessa riga in cui il testo di sessione diceva "Seoul sta scambiando ora": la riga
    // si contraddiceva da sola. Lo stato mancante e' il piu' insidioso — mercato APERTO, dato VECCHIO.
    /* ⚠ v234 — IL TERZO STATO DI v190 C'ERA MA NON SCATTAVA MAI. La condizione del "LIVE" era
       `price_live && seoulSessionOpen()`: due cose che INSIEME non stabiliscono la freschezza.
       `price_live` e' un flag della pipeline ("yfinance ha dato una quotazione live-ish"), non
       "catturata mentre Seoul scambiava"; `seoulSessionOpen()` guarda l'OROLOGIO DI ADESSO, non
       quello dello snapshot. Misurato sui dati veri: KOSPI -5,12% con price_live=true, snapshot
       delle 22:54Z = 07:54 a Seoul, cioe' un'ora PRIMA dell'apertura coreana — eppure la riga
       diceva "[LIVE, Seoul in contrattazione]" solo perche' alle 00:38 ET Seoul e' aperta.
       Manca il pezzo che conta: QUANDO e' stato preso il dato. Ora il LIVE richiede che lo
       snapshot stesso sia caduto dentro una sessione coreana — cosi' il terzo stato (mercato
       APERTO, dato VECCHIO), che v190 aveva scritto proprio per questo caso, diventa
       raggiungibile invece di restare codice morto. Classe v182/v193: stato del mercato e
       freschezza del dato sono due cose diverse. */
    ks && ks.change_pct != null ? (() => {
      const snap = DATA.updated_at ? new Date(DATA.updated_at) : null;
      const snapVivo = snap && !isNaN(snap) && seoulSessionOpen(snap);
      const oraKst = snap && !isNaN(snap)
        ? new Date(snap.getTime() + 9 * 3600e3).toISOString().slice(11, 16) : null;
      return `KOSPI ${signTxt(ks.change_pct)}${
        (ks.price_live && seoulSessionOpen() && snapVivo) ? " [LIVE, Seoul in contrattazione]"
        : seoulSessionOpen() ? ` [Seoul APERTA ora, ma questo valore viene dallo snapshot${oraKst ? ` delle ${oraKst} KST` : ""}, preso FUORI dalla sessione coreana: non è aggiornato in tempo reale]`
        : " [ultima chiusura di Seoul, borsa ferma]"}`;
    })() : null,
    fut.nasdaq?.change_pct != null ? `Fut NDX ${signTxt(fut.nasdaq.change_pct)}` : null,
    fut.sp500?.change_pct != null ? `Fut S&P ${signTxt(fut.sp500.change_pct)}` : null,
    btc && btc.change_pct != null ? `BTC ${signTxt(btc.change_pct)} [24/7]` : null,
  ].filter(Boolean).join(" · ");
  const beforeBell = s.phase === "notte" || s.phase === "pre-market" || s.phase === "weekend";
  // v161 — il rimando al blocco CATALIZZATORI si stampa SOLO se quel blocco esiste davvero in
  // questo payload (news post-chiusura presenti). Un rimando a una sezione assente è la stessa
  // classe di difetto dell'ex "A4": manda l'LLM a cercare qualcosa che non c'è.
  // La riga AFFERMA il fatto (N notizie dopo la campana) invece di RIMANDARE a una sezione: il
  // blocco CATALIZZATORI si genera solo se almeno una di quelle notizie tocca il book, quindi un
  // rimando incondizionato poteva puntare a una sezione assente (news post-chiusura tutte estranee
  // al portafoglio). Un'affermazione vera in ogni caso non può diventare pendente.
  const nUnp = (() => { try { return newsSplitByClose().unpriced.length; } catch { return 0; } })();
  const asiaViva = seoulSessionOpen();
  const guida = (s.phase === "weekend" && asiaViva)
    ? `WEEKEND a New York MA BORSA ASIATICA APERTA (Seoul sta scambiando ORA; apertura USA tra ~${hrs}h). ATTENZIONE ALLA FRESCHEZZA: la borsa coreana è aperta, ma il valore del KOSPI qui sopra viene dallo snapshot della pipeline e NON è aggiornato in tempo reale — è l'ultima chiusura, non la seduta in corso. Storicamente il primo mercato che vota sulle notizie del fine settimana è l'Asia, e i semiconduttori coreani sono i più correlati a questo book${nUnp ? `; le ${nUnp} notizie non ancora prezzate sono elencate sotto` : ""}`
    : s.phase === "weekend"
    ? `WEEKEND, MERCATI CHIUSI (apertura tra ~${hrs}h): l'unico dato che si muove ancora è il BTC (24/7) — KOSPI e futures sono fermi alla chiusura di venerdì e NON anticipano nulla di nuovo, sono già dentro l'ultima chiusura USA.${nUnp ? ` Il segnale fresco di questo run sono le ${nUnp} NOTIZIE arrivate dopo la campana, che il prezzo non ha ancora votato:` : " Nessuna notizia nuova dopo la campana:"} gli ordini valgono per l'apertura di lunedì, a limite, mai a mercato`
    : beforeBell
    ? `SEI PRIMA DELLA CAMPANA (apertura tra ~${hrs}h): KOSPI/Asia, futures USA e prezzi estesi (pre/after, "→ agg.") sono il dato più fresco — pesali come ANTICIPATORI nell'analisi; ogni ordine proposto vale per l'APERTURA della prossima seduta USA, limite sul "→ agg." quando presente, mai a mercato in apertura`
    : s.phase === "regular"
      ? `SESSIONE USA APERTA: i prezzi live hanno priorità; gli ordini limite sono eseguibili oggi`
      : `USA in AFTER-HOURS: gli ordini valgono per la prossima apertura (~${hrs}h); il "→ agg." incorpora già il gap after`;
  /* ═══ v232 — "ANTICIPATORI" NON E' VERO IN OGNI FASE ═══════════════════════════════════════
     Trovato eseguendo il payload su me stesso a mercato APERTO. La riga diceva
       "fase: REGULAR … · ANTICIPATORI: KOSPI -5,12% [chiusura di Seoul, borsa ferma] · Fut NDX
        +0,72% · … · SESSIONE USA APERTA: i prezzi live hanno priorita'"
     cioe' presentava come anticipatori due dati che NON anticipano piu' niente: la cosa che
     dovrebbero precedere — la seduta americana — sta gia' scambiando, e quei valori sono dentro
     i prezzi live che la riga stessa dichiara prioritari. Il lettore trova la parola
     ANTICIPATORI e la contraddizione tre parole dopo.
     La lezione e' quella di v158 (KOSPI e futures nel weekend "sono gia' dentro l'ultima
     chiusura USA e NON anticipano nulla"), applicata allora al TESTO della guida ma non
     all'ETICHETTA — che e' la parola che l'LLM legge per prima. Ora l'etichetta segue la fase:
     anticipano solo quando c'e' davvero un'apertura davanti. */
  /* ⚠ NON basta `beforeBell`: quella include il WEEKEND, dove la guida qui sopra dice
     testualmente che KOSPI e futures "sono gia' dentro l'ultima chiusura USA e NON anticipano
     nulla di nuovo" — l'etichetta avrebbe contraddetto il testo tre righe sotto, cioe' lo stesso
     difetto che sto correggendo, solo in un altro ramo. Anticipano quando c'e' davvero
     un'apertura davanti e il dato e' piu' fresco dell'ultima chiusura: notte, pre-market, after. */
  const etLead = (s.phase === "notte" || s.phase === "pre-market" || s.phase === "after")
    ? "ANTICIPATORI"
    : s.phase === "regular"
      ? "CONTESTO — NON anticipatori: la sessione USA e' aperta, quindi questi dati sono gia' dentro i prezzi live"
      : "FERMI — non anticipano nulla di nuovo: sono gia' dentro l'ultima chiusura USA";
  return `CONTESTO DI SESSIONE (ora ET ${s.etHHMM}, fase: ${s.phase.toUpperCase()} — festività USA non considerate)${lead ? ` · ${etLead}: ${lead}` : ""} · ${guida}.`;
}
/* ── OROLOGIO DEL PREZZO vs OROLOGIO DELLE NOTIZIE (v158) ─────────────────────────
   Il payload mescola due orologi: i PREZZI si fermano alla campana (venerdì 16:00 ET), le NEWS
   continuano ad arrivare. Senza questa distinzione il sistema commette un errore logico grave:
   confronta un prezzo di venerdì con una notizia di sabato e conclude che "il flusso non conferma
   la narrativa" — ma il prezzo NON PUÒ aver votato una notizia che non ha ancora visto.
   Queste funzioni separano le news GIÀ PREZZATE da quelle NON ANCORA PREZZATE (i catalizzatori
   della prossima apertura), che è informazione operativa che il payload prima non sapeva esprimere. */
function etUtcOffsetHours(d) {   // ore da sottrarre a UTC per avere l'ora di New York (4 EDT / 5 EST)
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return Math.round((utc - et) / 3600000);
}
/* istante UTC dell'ultima chiusura USA (16:00 ET del giorno di price_asof delle EQUITY:
   crypto/futures/indici esteri quotano 24/7 e falserebbero il confine) */
function lastUsEquityCloseUTC() {
  const eq = [...(DATA.portfolio || []), ...(DATA.watchlist || [])]
    .filter(r => r && r.currency === "USD" && !/-USD$|^\^|=F$/.test(r.ticker || "") && r.price_asof);
  const asof = eq.map(r => String(r.price_asof).slice(0, 10)).sort().pop();
  if (!asof) return null;
  const off = etUtcOffsetHours(new Date(asof + "T18:00:00Z"));
  const t = new Date(`${asof}T${String(16 + off).padStart(2, "0")}:00:00Z`);
  return isNaN(t) ? null : { at: t, asof };
}
/* news pubblicate DOPO l'ultima chiusura = non ancora nel prezzo.
   Esclude le voci sintetiche Polymarket (sono snapshot di probabilità, non notizie). */
const isRealNews = (n) => !!(n && n.title) && !/— probabilità Sì/.test(n.title_it || n.title);
function newsSplitByClose() {
  const close = lastUsEquityCloseUTC();
  const real = (DATA.news || []).filter(isRealNews);
  if (!close) return { unpriced: [], priced: real, close: null, total: real.length };
  const unpriced = [], priced = [];
  for (const n of real) {
    const t = n.published ? new Date(n.published) : null;
    (t && !isNaN(t) && t > close.at ? unpriced : priced).push(n);
  }
  return { unpriced, priced, close, total: real.length };
}
const seoulToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);   // UTC+9, niente DST
/* v171 — L'ASIA APRE MENTRE A NEW YORK È ANCORA DOMENICA. Il ramo "weekend" assumeva che tutto
   fosse fermo, ma il KOSPI apre alle 09:00 KST = 02:00 CEST del lunedì, quando l'orologio di New
   York segna ancora le 20:00 di domenica. In quella finestra il payload dichiarava "KOSPI fermo
   alla chiusura di venerdì, non anticipa nulla" mentre il KOSPI stava scambiando dal vivo — cioè
   proprio quando l'anticipatore asiatico è l'unica informazione nuova disponibile. */
function seoulSessionOpen(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600e3);        // Corea: UTC+9 fisso, nessun DST
  const g = kst.getUTCDay();
  if (g === 0 || g === 6) return false;                    // sabato/domenica a Seoul
  const min = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return min >= 540 && min < 930;                          // 09:00–15:30 KST
}
function shockSourcesLive() {
  const THR = -2.0, sources = [];
  const fut = (DATA.macro || {}).futures || {};
  for (const [k, lab] of [["nasdaq", "Futures Nasdaq 100"], ["sp500", "Futures S&P 500"]]) {
    const chg = dgFin((fut[k] || {}).change_pct);
    if (chg != null && chg <= THR) sources.push({ src: lab, chg });
  }
  // GATE DI SESSIONE (v141, stesso fix del server v127): il change_pct del KOSPI vale solo se
  // è della SESSIONE CORRENTE — price_live (delta ricalcolato in tempo reale) oppure candela
  // con price_asof = data di Seoul di OGGI. Una candela stantia ([chiusura del 16/07] letta il
  // 18) qui reintroduceva l'Allarme Fantasma che la pipeline aveva già soppresso.
  const k = (DATA.watchlist || []).find(r => r.ticker === "^KS11");
  const kc = k ? dgFin(k.change_pct) : null;
  // v176 — ALLARME FANTASMA, terza incarnazione. Il gate accettava `price_live === true` come prova
  // di freschezza, ma quel flag dice solo che il prezzo viene da fast_info: di DOMENICA, con Seoul
  // chiusa da venerdì e price_asof nullo, restava true e faceva scattare lo shock su un -5,72% di
  // due giorni prima — già dentro la chiusura USA di venerdì, quindi contato due volte. Ora il
  // "live" vale solo se la borsa di Seoul è DAVVERO in sessione (seoulSessionOpen, v171); fuori
  // sessione serve una data di rilevazione che sia oggi a Seoul. Su un allarme si sta stretti.
  const kFresh = k && ((k.price_live === true && seoulSessionOpen())
    || (k.price_asof && String(k.price_asof).slice(0, 10) === seoulToday()));
  if (kc != null && kc <= THR && kFresh) sources.push({ src: "KOSPI (Asia)", chg: kc });
  return sources;
}
function computeShockClient() {
  const sources = shockSourcesLive();
  if (!sources.length || usRegularSessionOpen()) return null;
  return { active: true, threshold: -2, sources, worst_chg: Math.min(...sources.map(s => s.chg)),
           note: "Asia/futures Nasdaq oltre -2% con Wall Street chiusa: sospendere gli acquisti "
               + "aggressivi, attendere l'assestamento della prima ora di scambi USA.", client: true };
}
function refreshShockClient() {
  // sovrascrive lo shock_alert (KOSPI live-autoritativo + futures di pipeline). Non tocca nient'altro.
  if (DATA && DATA.macro) DATA.macro.shock_alert = computeShockClient();
}

function renderShockAlert() {
  const box = $("#shock-alert");
  if (!box) return;
  const s = (DATA.macro || {}).shock_alert;
  if (!s || !s.active) { box.hidden = true; box.innerHTML = ""; return; }
  const src = s.sources.map(x => `${esc(x.src)} ${signTxt(x.chg)}`).join(" · ");
  box.hidden = false;
  box.className = "shock-alert-banner";
  box.innerHTML = `🚨 <b>SEGNALE DI SHOCK</b> — ${src}: caduta oltre il ${s.threshold}% con Wall Street chiusa. <b>Da verificare</b>, non un ordine: controlla la conferma USA (futures) prima di trarre conclusioni — se gli USA non confermano è un allarme localizzato. Il prompt AI porta il segnale in cima col suo workflow di verifica.`;
}

function renderDataQualityAlert() {
  const box = $("#dataquality-alert");
  if (!box) return;
  const v = validateMacroData();
  if (v.ok) { box.hidden = true; box.innerHTML = ""; box.className = ""; return; }
  const bad = v.bad.map(b => `<b>${esc(b.key)}</b> (${esc(b.status)}${b.note ? ": " + esc(b.note) : ""})`).join(" · ");
  const st = v.stale.map(s => esc(s.key)).join(", ");
  box.hidden = false;
  box.className = "data-error";
  box.style.cursor = "pointer";
  box.title = "Clicca per correggere manualmente i dati flaggati";
  box.innerHTML = `⚠ <b>QUALITÀ DATI MACRO</b> — ${bad ? `INAFFIDABILI: ${bad}. ` : ""}${st ? `Datati oltre la cadenza attesa: ${st}.` : ""} Il prompt AI li marca con flag espliciti. <button class="btn btn-ghost btn-sm" id="dq-fix" style="margin-left:8px">✎ Correggi dati</button>`;
  box.onclick = openDataQualityModal;
}

/* ═══ v245 — IL DIARIO E IL PORTAFOGLIO NON POSSONO DIVERGERE IN SILENZIO ══════════════════
   Segnalato dal CEO: "gli acquisti/vendite in diario non hanno aggiornato watchlist e
   portafoglio automaticamente."
   INDAGINE. Il meccanismo c'era ed era corretto: parseDiaryText legge bene l'operazione,
   applicaOpAlPortafoglio calcola bene il nuovo stato, editHoldings scrive bene sul repo.
   Il guasto stava nell'UNICO PUNTO DI PASSAGGIO: un `confirm()`. Se lo chiudi — per errore, o
   perche' su iPhone sembra un avviso di sistema — l'operazione si perde e NESSUNO te lo ricorda
   piu'. E reconcileState non poteva accorgersene, perche' confronta solo le posizioni PRESENTI
   col valore del broker: una posizione ASSENTE non ha nulla da confrontare.
   MISURATO IL 07/08/2026: data.json aveva 9 righe, il broker 13. Mancavano BE, MRVL, SKHY e WDC
   da due giorni, e OGNI analisi AI in quei due giorni ha ragionato su un terzo di portafoglio
   che non esisteva. Un dato mancante in silenzio e' peggio di un dato sbagliato che urla.
   ⚠ La correzione non e' "rendere il confirm piu' insistente": e' non far dipendere piu' la
   correttezza da un clic che puo' andare perso. La divergenza si RILEVA a ogni render, si
   MOSTRA finche' esiste, e finisce NEL PAYLOAD. */
function divergenzaDiario() {
  const out = { certe: [], daVerificare: [], asOf: (DATA?.broker || {}).as_of || null };
  if (!DATA || !Array.isArray(DATA.portfolio)) return out;
  let voci = [];
  try { voci = loadDiary(); } catch { return out; }
  if (!Array.isArray(voci) || !voci.length) return out;

  const inPtf = new Map((DATA.portfolio || []).map(r => [String(r.ticker || "").toUpperCase(), r]));
  /* ⚠ si guardano SOLO le operazioni successive allo snapshot del broker: prima di quella data
     il broker e' la fonte autorevole e ha gia' incorporato tutto. Senza questo filtro il
     banner riproporrebbe in eterno operazioni vecchie gia' assorbite. */
  const soglia = out.asOf ? out.asOf : null;
  const visti = new Set();

  for (const e of voci) {
    const o = (typeof diaryOp === "function") ? diaryOp(e) : (e.op || null);
    if (!o || !o.ticker || !o.tipo) continue;
    const iso = String(e.date || "").slice(0, 10);
    if (soglia && iso && iso <= soglia) continue;         // gia' dentro lo snapshot del broker
    const tk = String(o.ticker).toUpperCase();
    /* ⚠ v251 — IDEMPOTENZA. Il banner si calcolava contro DATA.portfolio, che arriva da
       data.json e resta indietro di 2-3 minuti finché la pipeline non rigenera. Dopo aver
       applicato, un semplice ricaricamento faceva RIAPPARIRE il banner — e il CEO, vedendolo,
       ha ricliccato: le quantità sono state applicate DUE VOLTE (BE 40→80, SKHY 45→90,
       WDC 25→50, MRVL 42→84). Una scrittura che si può ripetere senza accorgersene è un
       difetto peggiore di una che fallisce, perché fallisce in silenzio nella direzione
       sbagliata. La marcatura sta nel DIARIO, che è persistito nel repo e non dipende dal
       ritardo della pipeline. */
    if (e.applicata) continue;
    const chiave = `${iso}|${tk}|${o.tipo}|${o.qty}`;
    if (visti.has(chiave)) continue;                      // stessa voce salvata due volte
    visti.add(chiave);
    const pos = inPtf.get(tk);
    const acquisto = /ACQUIST|COMPR|INCREMENT|ACCUMUL|AGGIUNT/i.test(o.tipo);

    if (acquisto && !pos) {
      // CERTO: hai annotato un acquisto e quel titolo non e' in portafoglio. Non c'e' lettura
      // alternativa, ed e' esattamente il caso di BE, MRVL, SKHY e WDC.
      out.certe.push({ ...o, ticker: tk, iso, motivo: "acquisto annotato, titolo assente dal portafoglio" });
    } else if (!acquisto && pos && o.qty != null && Number(pos.qty) > 0) {
      /* NON e' certo: potrebbe essere una vendita parziale gia' applicata. Si dichiara come
         da verificare invece di affermare un errore che potrebbe non esserci. */
      out.daVerificare.push({ ...o, ticker: tk, iso, qtaAttuale: Number(pos.qty),
        motivo: `vendita annotata di ${o.qty}, in portafoglio ce ne sono ancora ${Number(pos.qty)}` });
    } else if (acquisto && pos && o.qty != null) {
      out.daVerificare.push({ ...o, ticker: tk, iso, qtaAttuale: Number(pos.qty),
        motivo: `acquisto annotato di ${o.qty}, in portafoglio ce ne sono ${Number(pos.qty)}` });
    }
  }
  out.needed = out.certe.length > 0 || out.daVerificare.length > 0;
  return out;
}

/* il banner: resta finche' la divergenza esiste, e porta il bottone che APPLICA.
   Non e' un promemoria da leggere: e' la via d'uscita dal problema. */
function renderDivergenzaDiario() {
  const box = document.querySelector("#divergenza-alert");
  if (!box) return;
  const d = divergenzaDiario();
  if (!d.needed) { box.hidden = true; box.innerHTML = ""; box.className = ""; return; }
  const pezzi = [];
  if (d.certe.length) {
    pezzi.push(`<b>${d.certe.length} operazion${d.certe.length === 1 ? "e" : "i"} annotate nel diario non sono nel portafoglio</b>: ` +
      d.certe.map(x => `${esc(x.ticker)} (${x.qty ?? "?"} quote del ${esc(x.iso)})`).join(" · "));
  }
  if (d.daVerificare.length) {
    pezzi.push(`da verificare: ${d.daVerificare.map(x => esc(x.motivo)).join(" · ")}`);
  }
  box.hidden = false;
  box.className = "data-error";
  box.innerHTML = `⚠ <b>DIARIO E PORTAFOGLIO NON COINCIDONO</b> — ${pezzi.join(". ")}. ` +
    `Finché non le allinei, <b>ogni analisi AI ragiona su un portafoglio che non esiste</b>.` +
    (d.certe.length ? ` <button class="btn btn-ghost btn-sm" id="div-applica" style="margin-left:8px">✎ Applica le operazioni mancanti</button>` : "");
  const b = box.querySelector("#div-applica");
  if (b) b.onclick = () => applicaDivergenzeMancanti(d.certe);
}

/* applica in sequenza le operazioni certe. Una per volta e con conferma singola: applicarle
   tutte insieme in silenzio sarebbe lo stesso errore al contrario. */
/* v250 — UNA CONFERMA, UNA SCRITTURA. La versione v245 ne faceva N con 400 ms di distanza e
   nessuna arrivava: leggevano tutte lo stesso SHA e si annullavano a vicenda. */
/* marca nel DIARIO le voci già applicate al portafoglio, così non possono esserlo due volte.
   Il diario vive in config/action_diary.json: la marcatura segue il CEO fra i dispositivi. */
function marcaVociApplicate(ops) {
  const chiavi = new Set(ops.map(o => `${o.iso}|${String(o.ticker).toUpperCase()}|${o.tipo}|${o.qty}`));
  let arr;
  try { arr = loadDiary(); } catch { return; }
  if (!Array.isArray(arr)) return;
  let tocc = 0;
  for (const e of arr) {
    const o = (typeof diaryOp === "function") ? diaryOp(e) : (e.op || null);
    if (!o || !o.ticker || !o.tipo) continue;
    const k = `${String(e.date || "").slice(0, 10)}|${String(o.ticker).toUpperCase()}|${o.tipo}|${o.qty}`;
    if (chiavi.has(k) && !e.applicata) { e.applicata = new Date().toISOString(); tocc++; }
  }
  if (tocc) setDiary(arr);
  return tocc;
}

async function applicaDivergenzeMancanti(certe) {
  const mut = [], errori = [];
  for (const op of certe) {
    const m = mutazionePerOp(op);
    if (!m) continue;
    if (m.errore) { errori.push(m.errore); continue; }
    mut.push(m);
  }
  if (!mut.length) {
    toast(errori.length ? `Nessuna applicabile: ${errori.join(" · ")}` : "Nessuna operazione da applicare");
    return;
  }
  const testo = mut.map(m => "· " + m.descr).join("\n");
  if (!confirm(`Applico ${mut.length} operazion${mut.length === 1 ? "e" : "i"} al portafoglio?\n\n${testo}\n\n` +
      `Una sola modifica su config/holdings.json: la vedrai anche da iPhone.` +
      (errori.length ? `\n\nNON applicabili: ${errori.join(" · ")}` : ""))) {
    toast("Posizioni NON modificate");
    return;
  }
  // anticipo ottimistico in locale, come per l'operazione singola (v193)
  for (const m of mut) aggiornaPortafoglioLocale(m.tk, m.acquisto, m.q, m.px);
  const ok = await editHoldings("portfolio", (cfg) => {
    /* ⚠ le mutazioni si compongono SULLO STESSO cfg, in ordine: ognuna rilegge dal file ciò
       che la precedente ha scritto. È la ragione per cui non si può fare una scrittura per
       operazione — e anche la ragione per cui l'ordine conta. */
    let almeno = false;
    for (const m of mut) { if (m.applica(cfg)) almeno = true; }
    return almeno;
  });
  if (ok === false) {
    toast("Scrittura non riuscita: le posizioni NON sono state aggiornate");
    renderDivergenzaDiario();
    return;
  }
  /* ⚠ si marca SOLO dopo una scrittura riuscita: marcare prima significherebbe perdere
     l'operazione se il salvataggio fallisce, cioè l'errore opposto e altrettanto grave. */
  marcaVociApplicate(certe);
  renderDivergenzaDiario();
}

function renderReconcileAlert() {
  const box = $("#reconcile-alert");
  if (!box) return;
  const rec = reconcileState();
  if (!rec.needed) { box.hidden = true; box.innerHTML = ""; box.className = ""; return; }
  const bits = [];
  if (rec.staleDays != null && rec.staleDays > 14) bits.push(`snapshot broker di <b>${rec.staleDays} giorni</b> fa (${esc((DATA.broker || {}).as_of || "")})`);
  if (rec.mismatches.length) bits.push(`posizioni incoerenti col broker: <b>${rec.mismatches.map(m => `${m.tk} ${m.dev > 0 ? "+" : ""}${m.dev}%`).join(", ")}</b>`);
  box.hidden = false;
  box.className = "data-error";
  box.innerHTML = `⚠ <b>RICONCILIA COL BROKER</b> — ${bits.join(" · ")}. Se hai operato senza aggiornare quantità/PMC, il motore sta ragionando su un portafoglio che non esiste più: usa "✎ Modifica valori" e aggiorna lo snapshot in holdings.json.`;
}

/* ---------------- liquidità (cash) ---------------- */
function renderCash() {
  const inp = $("#cash-input");
  if (inp && document.activeElement !== inp) inp.value = cashEur || "";
  const note = $("#cash-note");
  if (note) note.textContent = cashEur > 0 ? `inclusa nel totale e nell'allocazione (${fmtEUR.format(cashEur)})` : "";
}

function saveCash() {
  cashEur = parseFloat($("#cash-input").value) || 0;
  localStorage.setItem("cash_eur", cashEur);
  salvaStatoPortafoglio("cash");           // v244: la liquidità arriva anche su iPhone
  recomputeTotals();
  renderCash(); renderKPI(); renderAllocation();
  toast("Liquidità salvata ✓");
}

/* ---------------- mini-card: direzione mercato + BofA signposts ---------------- */
// aggregatore: raccoglie TUTTI i segnali del sistema con etichetta e punteggio 0-100
function directionComponents() {
  const m = DATA.macro || {};
  const c = [];
  if (m.risk_sentiment) c.push(["Sentiment globale", m.risk_sentiment.score]);
  if (m.thermometer) c.push(["Termometro portafoglio", m.thermometer.score]);
  if (m.fear_greed) c.push(["Fear & Greed", m.fear_greed.score]);
  if (m.vix) c.push(["Volatilità (VIX)", clamp(100 - m.vix.value / 50 * 100)]);
  if (m.signposts) c.push(["Segnali ribassisti BofA", 100 - m.signposts.pct]);
  if (m.macroquant) c.push(["MacroQuant (ciclo)", m.macroquant.score]);
  if (m.fedwatch && m.fedwatch.next_cut_prob != null) c.push(["Politica Fed (tagli attesi)", clamp(40 + m.fedwatch.next_cut_prob * 0.6)]);
  if (m.carry) c.push(["Carry USA-Giappone", clamp(50 + (m.carry.spread - 2) * 15)]);
  // media impatto degli indicatori macro (CPI, NFP, curva, ecc.)
  const imp = (m.indicators || []).filter(i => i.impact != null).map(i => i.impact);
  if (imp.length) c.push(["Dati macro USA (media)", Math.round(imp.reduce((a, b) => a + b, 0) / imp.length)]);
  // rotazione settoriale: settori ciclici forti = pro-rischio
  if ((m.tilt || []).length) c.push(["Rotazione settoriale", Math.round(m.tilt.reduce((a, s) => a + s.score, 0) / m.tilt.length)]);
  return c.map(([label, score]) => ({ label, score: Math.round(score) }));
}
function marketDirectionScore() {
  const c = directionComponents();
  if (!c.length) return null;
  return Math.round(c.reduce((a, b) => a + b.score, 0) / c.length);
}

/* ---------------- Top bar "Decisione" + diario delle azioni ---------------- */
function loadDiary() {
  try { return JSON.parse(localStorage.getItem("action_diary") || "[]"); } catch { return []; }
}
function setDiary(arr) {
  localStorage.setItem("action_diary", JSON.stringify(arr.slice(0, 100)));
  pushDiaryCloud(arr);   // sync su GitHub se c'è un token (così è uguale su Mac e iPhone)
}
/* ═══ v165 — FORMATO DEL DIARIO ═══════════════════════════════════════════════
   Il diario era testo libero: ogni voce con una forma diversa ("vendita SKHY 50 quote a 172",
   "Acquisto 70 azioni oracle ... a 143 dollari"), difficile da leggere e impossibile da
   incrociare con la Tabella A. Ora ogni voce ha un OP strutturato {tipo, qty, ticker, prezzo,
   data}; il testo originale non viene mai perso (resta in `text` e viaggia nell'export AI).
   Le voci già memorizzate vengono formattate al volo dal parser, senza riscrivere i dati. */
const DIARY_BUY = /\b(acquist|comprat|compra|incrementat|accumulat|aggiunt)/i;
const DIARY_SELL = /\b(vendit|vendut|vendo|alleggerit|ridott|chius|liquidat)/i;
/* ticker dal nome esteso: la mappa si costruisce dai dati veri (portafoglio + watchlist),
   così un nome nuovo entra da solo senza toccare il codice */
function diaryTickerMap() {
  const m = new Map();
  for (const r of [...(DATA?.portfolio || []), ...(DATA?.watchlist || [])]) {
    if (!r || !r.ticker) continue;
    m.set(r.ticker.toUpperCase(), r.ticker);
    const nome = String(r.name || "").replace(/\b(inc|corp|corporation|ltd|plc|group|company|co|technologies|technology|systems|platforms|holdings)\b\.?/gi, "").trim();
    const primo = nome.split(/[\s,.]+/)[0];
    if (primo && primo.length >= 3) m.set(primo.toUpperCase(), r.ticker);
  }
  // alias che i dati non possono dare (nomi commerciali usati nel diario)
  for (const [k, v] of [["ORACLE", "ORCL"], ["MICRON", "MU"], ["STRATEGY", "MSTR"], ["CEREBRAS", "CBRS"],
                        ["TESLA", "TSLA"], ["INTEL", "INTC"], ["ALPHABET", "GOOGL"], ["GOOGLE", "GOOGL"]]) {
    if (!m.has(k)) m.set(k, v);
  }
  return m;
}
const MESI_IT = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
/* estrae l'operazione da una voce a testo libero — best effort, mai distruttivo */
function parseDiaryText(text, fallbackIso) {
  const t = String(text || "");
  const tipo = DIARY_SELL.test(t) ? "VENDITA" : DIARY_BUY.test(t) ? "ACQUISTO" : null;
  const map = diaryTickerMap();
  let ticker = null;
  for (const w of t.split(/[^A-Za-z0-9.\-]+/)) {
    const hit = map.get(w.toUpperCase());
    if (hit) { ticker = hit; break; }
  }
  // quantità: "50 quote", "quantità 30", "70 azioni", "di 10 azioni"
  const mq = t.match(/(\d[\d.]*)\s*(?:quote|azioni|titoli|pezzi)/i) || t.match(/quantit[àa]\s*(\d[\d.]*)/i);
  const qty = mq ? parseInt(String(mq[1]).replace(/\./g, ""), 10) : null;
  // prezzo: "a 172", "prezzo 190,10", "a 143 dollari"
  const mp = t.match(/(?:prezzo|a|@)\s*(\d+(?:[.,]\d+)?)\s*(?:doll|usd|\$|eur|€)?/i);
  const prezzo = mp ? parseFloat(mp[1].replace(",", ".")) : null;
  // data esplicita nel testo ("il 15 luglio 2026"), altrimenti la data di registrazione
  let quando = null;
  const md = t.match(/(\d{1,2})\s+([a-zà]+)\s+(\d{4})/i);
  if (md) { const mi = MESI_IT.indexOf(md[2].toLowerCase()); if (mi >= 0) quando = `${String(md[1]).padStart(2, "0")}/${String(mi + 1).padStart(2, "0")}/${md[3]}`; }
  if (!quando && fallbackIso) { const d = new Date(fallbackIso); if (!isNaN(d)) quando = d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }); }
  // più operazioni nella stessa voce: si dichiara, non si finge di averle strutturate tutte
  const multi = (t.match(new RegExp(DIARY_BUY.source + "|" + DIARY_SELL.source, "gi")) || []).length > 1;
  return { tipo, qty, ticker, prezzo, quando, multi };
}
/* l'operazione di una voce: quella salvata se c'è, altrimenti dedotta dal testo */
function diaryOp(e) {
  if (e && e.op && (e.op.tipo || e.op.ticker)) return { ...e.op, multi: !!e.op.multi };
  return parseDiaryText(e && e.text, e && e.date);
}
/* riga formattata: TIPO · QTÀ TICKER · PREZZO · DATA (i campi assenti si omettono) */
function diaryOpLine(e) {
  const o = diaryOp(e);
  const bits = [];
  if (o.tipo) bits.push(`<b class="${o.tipo === "ACQUISTO" ? "pos" : "neg"}">${o.tipo}</b>`);
  if (o.qty != null && o.ticker) bits.push(`${fmtNum.format(o.qty)} ${esc(o.ticker)}`);
  else if (o.ticker) bits.push(esc(o.ticker));
  else if (o.qty != null) bits.push(`${fmtNum.format(o.qty)} quote`);
  if (o.prezzo != null) bits.push(`@ ${fmtNum.format(o.prezzo)}`);
  if (o.quando) bits.push(o.quando);
  if (!bits.length) return "";
  return `<span class="diary-op">${bits.join(" · ")}</span>${o.multi ? `<span class="diary-multi" title="La voce contiene più operazioni: strutturata la prima, il testo integrale resta sotto">+ altre operazioni nel testo</span>` : ""}`;
}
/* ═══ v193 — IL DIARIO AGGIORNA LE POSIZIONI (richiesta CEO).
   Prima annotare "venduto 50 GOOGL a 318" lasciava il portafoglio invariato: il motore
   continuava a calcolare stop, pesi e MCR su una posizione che non esisteva piu'. Il banner
   "RICONCILIA COL BROKER" segnalava lo scarto ma la correzione restava a mano.
   La scrittura va su config/holdings.json tramite la stessa API che usa "Modifica valori":
   e' il repo, quindi iPhone e computer leggono LA STESSA fonte — era la seconda meta' della
   richiesta ("si deve fasare anche con safari iPhone").
   NON silenzioso: modificare quantita' e PMC cambia i numeri su cui si decide, quindi si
   mostra prima l'effetto esatto e si chiede conferma. Una riga sola da toccare, ma consapevole. */
/* ═══ v250 — LE OPERAZIONI SI APPLICANO IN UNA SOLA SCRITTURA ══════════════════════════════
   Segnalato dal CEO: "anche se applico rimane sempre il banner", e la concentrazione non si
   aggiornava. MISURATO: config/holdings.json era ancora a 8 posizioni dopo l'applicazione.
   LA CAUSA È MIA, dal v245: `applicaDivergenzeMancanti` chiamava `applicaOpAlPortafoglio` una
   volta per operazione con 400 ms di attesa in mezzo. Ma quella funzione NON restituisce la
   promessa di `editHoldings`, quindi non c'era niente da aspettare, e 400 ms non bastano
   comunque per un giro completo sull'API GitHub (lettura SHA + scrittura). Le quattro
   scritture leggevano lo STESSO sha e andavano in conflitto: nessuna arrivava a destinazione.
   ⚠ Non è "aspettare di più": è che N scritture sullo stesso file sono un errore di disegno.
   Si compone UNA mutazione con dentro tutte le operazioni e si scrive UNA volta sola — una
   conferma, un commit, nessuna corsa. */
function mutazionePerOp(op) {
  if (!op || !op.ticker || !op.tipo) return null;
  const q = Number(op.qty), px = Number(op.prezzo);
  if (!Number.isFinite(q) || q <= 0) return { errore: `${op.ticker}: operazione senza quantità` };
  const tk = String(op.ticker).toUpperCase();
  const pos = (DATA.portfolio || []).find(r => r.ticker === tk);
  const acquisto = /ACQUIST|COMPR|INCREMENT|ACCUMUL|AGGIUNT/i.test(op.tipo);
  if (acquisto) {
    if (!Number.isFinite(px) || px <= 0) return { errore: `${tk}: acquisto senza prezzo, PMC non calcolabile` };
    const q0 = pos ? Number(pos.qty) || 0 : 0, p0 = pos ? Number(pos.pmc) || 0 : 0;
    const q1 = q0 + q, pmc1 = Math.round(((q0 * p0 + q * px) / q1) * 10000) / 10000;
    return {
      tk, acquisto, q, px,
      descr: pos ? `${tk}: ${q0} → ${q1} quote · PMC ${fmtNum.format(p0)} → ${fmtNum.format(pmc1)}`
                 : `${tk}: NUOVA posizione, ${q} quote a PMC ${fmtNum.format(px)}`,
      applica: (cfg) => {
        cfg.portfolio = cfg.portfolio || [];
        /* ⚠ si rilegge la quantità DAL FILE, non da DATA: componendo più operazioni la seconda
           deve partire da ciò che la prima ha appena scritto, non dallo stato iniziale. */
        const e = cfg.portfolio.find(r => (r.ticker || "").toUpperCase() === tk);
        if (e) {
          const qa = Number(e.qty) || 0, pa = Number(e.pmc) || 0, qn = qa + q;
          e.qty = qn; e.pmc = Math.round(((qa * pa + q * px) / qn) * 10000) / 10000;
        } else cfg.portfolio.push({ ticker: tk, qty: q, pmc: px });
        if (Array.isArray(cfg.watchlist)) cfg.watchlist = cfg.watchlist.filter(r => (typeof r === "string" ? r : r.ticker || "").toUpperCase() !== tk);
        return true;
      },
    };
  }
  if (!pos) return { errore: `${tk} non è in portafoglio: vendita solo annotata` };
  const q0 = Number(pos.qty) || 0, q1 = Math.max(0, Math.round((q0 - q) * 10000) / 10000);
  return {
    tk, acquisto, q, px,
    descr: q1 === 0 ? `${tk}: posizione CHIUSA (${q0} quote vendute) — passa in watchlist`
                    : `${tk}: ${q0} → ${q1} quote (PMC invariato: vendere non lo cambia)`,
    applica: (cfg) => {
      let chiusa = false;
      cfg.portfolio = (cfg.portfolio || []).filter(r => {
        if ((r.ticker || "").toUpperCase() !== tk) return true;
        const qa = Number(r.qty) || 0, qn = Math.max(0, Math.round((qa - q) * 10000) / 10000);
        if (qn === 0) { chiusa = true; return false; }
        r.qty = qn; return true;
      });
      if (chiusa) {
        cfg.watchlist = cfg.watchlist || [];
        if (!cfg.watchlist.some(r => (typeof r === "string" ? r : r.ticker || "").toUpperCase() === tk)) cfg.watchlist.push(tk);
      }
      return true;
    },
  };
}

function applicaOpAlPortafoglio(op) {
  if (!op || !op.ticker || !op.tipo) return;
  const q = Number(op.qty), px = Number(op.prezzo);
  if (!Number.isFinite(q) || q <= 0) { toast("Operazione senza quantità: posizioni non aggiornate"); return; }
  const tk = String(op.ticker).toUpperCase();
  const pos = (DATA.portfolio || []).find(r => r.ticker === tk);
  const acquisto = /ACQUIST/i.test(op.tipo);

  let descr, applica;
  if (acquisto) {
    const q0 = pos ? Number(pos.qty) || 0 : 0, p0 = pos ? Number(pos.pmc) || 0 : 0;
    if (!Number.isFinite(px) || px <= 0) { toast("Acquisto senza prezzo: PMC non calcolabile, posizioni non aggiornate"); return; }
    const q1 = q0 + q;
    const pmc1 = Math.round(((q0 * p0 + q * px) / q1) * 10000) / 10000;   // media ponderata
    descr = pos
      ? `${tk}: ${q0} → ${q1} quote · PMC ${fmtNum.format(p0)} → ${fmtNum.format(pmc1)}`
      : `${tk}: NUOVA posizione, ${q} quote a PMC ${fmtNum.format(px)}` + ((DATA.watchlist || []).some(r => r.ticker === tk) ? " (esce dalla watchlist)" : "");
    applica = (cfg) => {
      cfg.portfolio = cfg.portfolio || [];
      const e = cfg.portfolio.find(r => (r.ticker || "").toUpperCase() === tk);
      if (e) { e.qty = q1; e.pmc = pmc1; } else cfg.portfolio.push({ ticker: tk, qty: q1, pmc: pmc1 });
      if (Array.isArray(cfg.watchlist)) cfg.watchlist = cfg.watchlist.filter(r => (typeof r === "string" ? r : r.ticker || "").toUpperCase() !== tk);
    };
  } else {
    if (!pos) { toast(`${tk} non è in portafoglio: vendita annotata, posizioni non modificate`); return; }
    const q0 = Number(pos.qty) || 0, q1 = Math.max(0, Math.round((q0 - q) * 10000) / 10000);
    descr = q1 === 0
      ? `${tk}: posizione CHIUSA (${q0} quote vendute) — passa in watchlist`
      : `${tk}: ${q0} → ${q1} quote (PMC invariato: vendere non lo cambia)`;
    applica = (cfg) => {
      cfg.portfolio = (cfg.portfolio || []).filter(r => {
        const t = (r.ticker || "").toUpperCase();
        if (t !== tk) return true;
        if (q1 === 0) return false;
        r.qty = q1; return true;
      });
      if (q1 === 0) {
        cfg.watchlist = cfg.watchlist || [];
        if (!cfg.watchlist.some(r => (typeof r === "string" ? r : r.ticker || "").toUpperCase() === tk)) cfg.watchlist.push(tk);
      }
    };
  }

  if (!confirm(`Aggiorno le posizioni con questa operazione?\n\n${descr}\n\nLa modifica va su config/holdings.json: la vedrai anche da iPhone.`)) {
    toast("Operazione annotata nel diario; posizioni NON modificate");
    return;
  }
  // AGGIORNAMENTO IMMEDIATO IN LOCALE. editHoldings scrive sul repo e lascia rigenerare la
  // pipeline (2-3 minuti): senza questo passaggio il CEO annota la vendita e continua a vedere
  // la posizione, che e' esattamente il disallineamento che la richiesta voleva eliminare.
  // Il repo resta la fonte autorevole; questo e' solo l'anticipo ottimistico di cio' che
  // arrivera' col prossimo run, e i campi calcolati dalla pipeline si riallineano da soli.
  aggiornaPortafoglioLocale(tk, acquisto, q, px);
  editHoldings("portfolio", applica);
}
function aggiornaPortafoglioLocale(tk, acquisto, q, px) {
  if (!DATA || !Array.isArray(DATA.portfolio)) return;
  const pos = DATA.portfolio.find(r => r.ticker === tk);
  if (acquisto) {
    if (pos) {
      const q0 = Number(pos.qty) || 0, p0 = Number(pos.pmc) || 0, q1 = q0 + q;
      pos.qty = q1; pos.pmc = Math.round(((q0 * p0 + q * px) / q1) * 10000) / 10000;
    } else {
      // titolo nuovo: si prende la riga della watchlist se c'e' (ha gia' prezzo e statistiche),
      // altrimenti si aspetta la pipeline — meglio nessuna riga che una riga inventata.
      const wl = (DATA.watchlist || []).find(r => r.ticker === tk);
      if (wl) {
        DATA.portfolio.push({ ...wl, qty: q, pmc: px });
        DATA.watchlist = DATA.watchlist.filter(r => r.ticker !== tk);
      } else { toast(`${tk} sarà in portafoglio dopo il prossimo aggiornamento dati`); }
    }
  } else if (pos) {
    const q1 = Math.max(0, Math.round(((Number(pos.qty) || 0) - q) * 10000) / 10000);
    if (q1 === 0) {
      DATA.portfolio = DATA.portfolio.filter(r => r.ticker !== tk);
      if (!(DATA.watchlist || []).some(r => r.ticker === tk)) (DATA.watchlist = DATA.watchlist || []).push({ ...pos, qty: null, pmc: null });
    } else pos.qty = q1;
  }
  // ricalcolo e ridisegno TUTTO cio' che dipende dalle posizioni: e' la parte "devono essere
  // correlate" della richiesta — tabelle, KPI e torta dell'allocazione da una sola fonte.
  try { recomputeTotals(); } catch { /* dati incompleti: la pipeline riallinea */ }
  try { renderKPI(); renderTable(); renderWatchlist(); renderAllocation(); } catch (e) { console.error(e); }
}

function saveDiaryEntry(text, op) {
  const arr = loadDiary();
  const iso = new Date().toISOString();
  const opFin = op || parseDiaryText(text, iso);
  arr.unshift({ date: iso, text, op: opFin });
  setDiary(arr);
  // se l'annotazione descrive un'operazione riconoscibile, si propone di allineare le posizioni
  if (opFin && opFin.ticker && opFin.tipo) applicaOpAlPortafoglio(opFin);
  /* ⚠ v245: si ricontrolla SEMPRE, anche se il confirm è stato rifiutato. È proprio il caso
     in cui il vecchio codice si arrendeva, e l'operazione spariva senza lasciare traccia. */
  if (typeof renderDivergenzaDiario === "function") renderDivergenzaDiario();
}
function deleteDiaryEntry(iso) {
  setDiary(loadDiary().filter(e => e.date !== iso));
}
const DIARY_PATH = "config/action_diary.json";
/* salva il diario su GitHub (config/action_diary.json) — solo se c'è già un token salvato (no prompt) */
async function pushDiaryCloud(arr) {
  const token = localStorage.getItem("gh_token");
  if (!token) return;
  try {
    let sha;
    const g = await fetch(`https://api.github.com/repos/${REPO}/contents/${DIARY_PATH}`, { headers: ghHeaders(token), cache: "no-store" });
    if (g.ok) sha = (await g.json()).sha;
    await fetch(`https://api.github.com/repos/${REPO}/contents/${DIARY_PATH}`, {
      method: "PUT", headers: ghHeaders(token),
      body: JSON.stringify({ message: "Aggiorna diario azioni", content: btoa(unescape(encodeURIComponent(JSON.stringify(arr, null, 1)))), sha }),
    });
  } catch { /* offline o senza permessi: resta comunque in locale */ }
}
/* carica il diario dal cloud all'avvio e lo fonde col locale (per date univoche) */
async function loadDiaryCloud() {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${DIARY_PATH}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const cloud = await r.json();
    if (!Array.isArray(cloud)) return;
    const byDate = {};
    [...cloud, ...loadDiary()].forEach(e => { if (e && e.date) byDate[e.date] = e; });
    const merged = Object.values(byDate).sort((a, b) => (a.date < b.date ? 1 : -1));
    localStorage.setItem("action_diary", JSON.stringify(merged.slice(0, 100)));
  } catch { /* nessun diario remoto ancora */ }
}

/* ---------------- motore decisionale (mandato quant: Sharpe > 2.0 + sovraperformance vs NDX) ---------------- */
// solo titoli AZIONARI USA (esclude indici ^, cripto/commodity con - o =, BTP, valuta PTS)
function isEquity(r) {
  return r && r.currency === "USD" && !/[\^=]/.test(r.ticker) && !r.ticker.includes("-") && r.ticker !== "BTP-V28";
}

/* ATR del titolo: dato pipeline (ATR 14 Wilder) se disponibile, altrimenti proxy statistico
   documentato: σ giornaliera dei rendimenti 1M × prezzo × 1,4 (per un processo diffusivo il
   True Range medio ≈ 1,4·σ). Il proxy sparisce da solo al primo run della pipeline. */
function atrOf(r) {
  if (r.atr_14 != null && r.price) {
    return { atr: r.atr_14, pct: r.atr_pct ?? Math.round(r.atr_14 / r.price * 10000) / 100, src: "ATR14" };
  }
  const m1 = (r.sparks || {}).m1 || [];
  if (m1.length >= 10 && r.price) {
    const rets = [];
    for (let i = 1; i < m1.length; i++) if (m1[i - 1]) rets.push(m1[i] / m1[i - 1] - 1);
    const mean = avg(rets);
    const sd = Math.sqrt(avg(rets.map(x => (x - mean) ** 2)));
    if (sd > 0) return { atr: r.price * sd * 1.4, pct: Math.round(sd * 1.4 * 10000) / 100, src: "proxy σ1M" };
  }
  return null;
}
/* stop loss dinamico: 2×ATR sotto il prezzo di riferimento (ingresso o prezzo attuale per trailing) */
function atrStop(refPrice, r) {
  const a = atrOf(r);
  if (!a || !(refPrice > 0) || !(a.atr > 0)) return null;
  let stop = refPrice - 2 * a.atr;
  // SCUDO SOTTO-ZERO (v115): uno stop loss non esiste in territorio negativo. Se 2×ATR
  // mangia più del 50% del riferimento (ATR avvelenato da barre-glitch o riferimento
  // sbagliato — visto sul campo: SNDK stop -$366) il numero non è risk management:
  // pavimento al 50% del riferimento, SEMPRE dichiarato nella sorgente.
  const floored = stop < refPrice * 0.5;
  if (floored) stop = refPrice * 0.5;
  return { stop: Math.round(stop * 100) / 100, atr: a.atr, pct: a.pct,
           src: a.src + (floored ? " — PAVIMENTO 50%: 2×ATR anomalo, verificare il dato" : "") };
}

/* PARACADUTE ORDINI (v115, post-incidente SNDK limite $40,1 su quotazione $1915):
   il supporto per un ORDINE deve venire dal passato RECENTE (pipeline: min Low 20 sedute,
   più le finestre brevi w1/m1) e stare in una banda operativa dal prezzo. MAI il range
   del grafico (y1 = minimo di un anno fa = preistoria). Se nessun supporto è plausibile,
   fallback DICHIARATO: SMA50 → pullback 2×ATR → -5%. Niente scarti silenziosi. */
const ORDER_SUPPORT_MAX_GAP = 0.25;   // un limite >25% sotto il mercato non è un ordine: è una preghiera
function saneEntryLimit(r) {
  const price = r.price;
  if (!(price > 0)) return null;
  const ok = (s) => s > 0 && s <= price && s >= price * (1 - ORDER_SUPPORT_MAX_GAP);
  const cands = [r.support, r.tech_by_range?.m1?.support, r.tech_by_range?.w1?.support].filter(ok);
  if (cands.length) return { limit: Math.max(...cands), src: "supporto recente", fallback: false };
  const sma50 = r.sma50_dist_pct != null ? price / (1 + r.sma50_dist_pct / 100) : null;
  if (ok(sma50)) return { limit: Math.round(sma50 * 100) / 100, src: "SMA50", fallback: true };
  const a = atrOf(r);
  const atrPull = a && a.atr > 0 ? price - 2 * a.atr : null;
  if (ok(atrPull)) return { limit: Math.round(atrPull * 100) / 100, src: "pullback 2×ATR", fallback: true };
  return { limit: Math.round(price * 0.95 * 100) / 100, src: "-5% dal prezzo (nessun supporto plausibile)", fallback: true };
}

/* stop operativo di una POSIZIONE APERTA: priorità allo stop RATCHET della pipeline
   (stop_atr: sale col prezzo e non ridiscende — persistito tra i run), fallback al
   calcolo client 2×ATR dal prezzo attuale (non ancorato, etichettato). */
function stopOf(r) {
  // cintura client (v115): uno stop ratchet ≤ 0 o assurdo (>3× il prezzo) è un residuo
  // di run avvelenato — si ignora e si ricalcola dal vivo, mai fidarsi di un numero malato
  if (r.stop_atr != null && r.stop_atr > 0 && (!(r.price > 0) || r.stop_atr <= r.price * 3)) {
    return { stop: r.stop_atr, violated: !!r.stop_violated, ratchet: true,
             pct: r.atr_pct ?? null, src: "ratchet 2×ATR" };
  }
  const st = atrStop(r.price, r);
  if (!st) {
    // STOP PROVVISORIO v119: una posizione DETENUTA senza ATR (IPO con storia <15 sedute,
    // es. SKHYV) resterebbe SENZA PROTEZIONE — un titolo in portafoglio senza stop è un buco
    // di risk management. Finché la serie non basta al 2×ATR, stop provvisorio −12% dal
    // prezzo (dichiarato), sostituito dal ratchet reale appena l'ATR è disponibile.
    if (r.qty && r.price > 0) {
      const prov = Math.round(r.price * 0.88 * 100) / 100;
      return { stop: prov, violated: r.price < prov, ratchet: false, pct: 12,
               src: "provvisorio −12% (ATR n.d.: storia <15 sedute, da inizializzare)" };
    }
    return null;
  }
  const inGain = r.qty && r.pmc != null && r.price > r.pmc;
  const stop = inGain ? Math.max(st.stop, r.pmc) : st.stop;
  return { stop: Math.round(stop * 100) / 100, violated: r.price < stop, ratchet: false, pct: st.pct, src: st.src };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
   PARAMETRI DI RISCHIO DEL FONDO (v121) — direttive del CEO, calibrate il 12/07/2026.
   Un unico punto di verità per le soglie che governano il verdetto: cambiare qui = cambiare
   la politica di rischio, senza cercare numeri sparsi nel codice.
   Filosofia: mandato Growth "Let Winners Run" — si cappa l'INGRESSO su ciò che è già grande,
   NON si trimma ciò che è cresciuto da solo (protetto dallo stop ratchet 2×ATR).
   ═══════════════════════════════════════════════════════════════════════════════════════ */
// Soglia di RILEVANZA della RS velocity (Δ7g della forza relativa vs NDX): sotto questa un
// movimento è RUMORE per definizione del payload. Sorgente unica, riusata sia nell'etichetta
// "|Δ|≥3pp = variazione RILEVANTE" sia nel gate ⚠deg (che prima scattava su -0,3pp = rumore).
const RS_VEL_RILEVANTE_PP = 3;
const RISK_PARAMS = {
  capNoAdd_pct: 10,        // #1 — DIVIETO DI ACCUMULO se la posizione è già ≥ questo % del NAV
                           //      (cap rigido SOLO sui nuovi acquisti). ⚠ QUESTO È SOLO IL DEFAULT:
                           //      il valore OPERATIVO arriva da config/risk_params.json (editabile
                           //      dalla card Parametri di Rischio e sincronizzato su tutti i device).
                           //      Non dedurre dal codice quale cap sia attivo: leggilo dal config.
  capAlert_pct: 25,        // #1 — ALERT di concentrazione singolo titolo (solo avviso, NIENTE
                           //      trim automatico: sotto il 25% i vincenti corrono liberi)
  sortinoVeto: -0.3,       // #2 — soglia veto VALUE TRAP sul Sortino 1A (CEO: mantieni rigido)
  sectorAlert_frac: 0.75,  // #6 — ALERT concentrazione settoriale > 75% del capitale azionario
                           //      (mandato tech/growth: la forte esposizione è la normalità)
  minScore: 60,            // #8 — score quant minimo per candidato d'accumulo
  maxLossPerPos_pct: 2,    // #11 — CAP SULLA PERDITA POTENZIALE: quanto può costare al NAV una
                           //      singola posizione se il suo stop viene eseguito. Lega la
                           //      DIMENSIONE allo STOP: un titolo volatile (stop lontano) può
                           //      entrare solo con poche quote, uno tranquillo con molte. È il
                           //      cap che il peso% non sa esprimere, perché 20% di un'utility e
                           //      20% di un semi a beta 2,8 sono rischi incomparabili.
  factorRiskAlert_pct: 60, // #12 — CONCENTRAZIONE DI FATTORE: quota massima della VARIANZA totale
                           //      (somma degli MCR) attribuibile a un solo settore/fattore. Il veto
                           //      qualità guarda un titolo alla volta ed è cieco alle correlazioni:
                           //      N nomi tutti "sani" possono crollare insieme se condividono il
                           //      fattore. Questa è la soglia che quel rischio non aveva.
  // #10 riserva tail-risk (budget = cassa − ES95): confermata dal CEO, gestita in pipeline.
  // #7 stop 2×ATR ratchet e #4 riabilitazione growth: confermati invariati.
};

/* EDITOR PARAMETRI DI RISCHIO (v143) — il CEO calibra le soglie dalla UI, senza toccare il
   codice. Ogni parametro ha spiegazione, banda di validità e default; gli override vivono in
   localStorage (questo browser) e MUTANO RISK_PARAMS al volo: motore, verdetto ed export AI
   usano immediatamente il nuovo valore. I parametri Python-side (stop 2×ATR, riserva ES95)
   NON sono qui: vivono in pipeline e restano fissi by design. */
const RISK_PARAM_DEFS = [
  { key: "capNoAdd_pct", label: "Cap d'ingresso singolo titolo (% NAV)", unit: "%", scale: 1, min: 1, max: 50, step: 0.5, def: 10,
    desc: "Divieto di NUOVI acquisti quando una posizione pesa già almeno questa percentuale del NAV. Non forza vendite: la posizione può continuare a correre (Let Winners Run)." },
  { key: "capAlert_pct", label: "Alert concentrazione singolo titolo (% NAV)", unit: "%", scale: 1, min: 5, max: 90, step: 1, def: 25,
    desc: "Sopra questa percentuale del NAV su un solo titolo scatta l'avviso di concentrazione. Solo segnalazione: mai trim automatico." },
  { key: "sortinoVeto", label: "Soglia veto VALUE TRAP (Sortino 12M)", unit: "", scale: 1, min: -3, max: 0, step: 0.05, def: -0.3,
    desc: "Sortino a 12 mesi sotto questo valore = titolo escluso dai nuovi acquisti (value trap: distruzione di valore sul downside). È evidenza forte, superabile solo con tesi dichiarata; più il valore è vicino a 0, più il veto è severo." },
  { key: "sectorAlert_frac", label: "Alert concentrazione settoriale (%)", unit: "%", scale: 100, min: 10, max: 100, step: 1, def: 75,
    desc: "Avviso quando il primo settore supera questa percentuale del capitale AZIONARIO (liquidità e obbligazioni escluse). Il mandato growth tollera un tech alto: la soglia dice quando dichiararlo." },
  { key: "maxLossPerPos_pct", label: "Perdita massima per posizione (% NAV allo stop)", unit: "%", scale: 1, min: 0.25, max: 15, step: 0.25, def: 2,
    desc: "Quanto può costare al patrimonio UNA posizione se il suo stop viene eseguito. Lega la dimensione alla distanza dello stop: più il titolo è volatile, meno quote entrano a parità di rischio. Complementare al cap sul peso, che ignora la volatilità." },
  { key: "factorRiskAlert_pct", label: "Concentrazione di rischio per fattore (% varianza)", unit: "%", scale: 1, min: 20, max: 100, step: 5, def: 60,
    desc: "Quota massima della varianza totale (somma degli MCR) attribuibile a un solo settore/fattore. Il veto qualità valuta un titolo per volta e non vede le correlazioni: titoli tutti sani possono scendere insieme se condividono il fattore. Solo segnalazione." },
  { key: "minScore", label: "Score minimo candidati (0–100)", unit: "", scale: 1, min: 0, max: 100, step: 1, def: 60,
    desc: "Punteggio quant minimo (Sharpe marginale + forza relativa + qualità) perché un titolo diventi candidato all'accumulo del motore. Alzarlo = meno candidati ma più selettivi." },
];
function applyRiskOverrides() {
  let ov = {};
  try { ov = JSON.parse(localStorage.getItem("risk_params_overrides") || "{}"); } catch { ov = {}; }
  for (const d of RISK_PARAM_DEFS) {
    const v = ov[d.key];
    if (typeof v === "number" && Number.isFinite(v) && v >= d.min / d.scale - 1e-9 && v <= d.max / d.scale + 1e-9) {
      RISK_PARAMS[d.key] = v;                 // valore INTERNO (già in scala frazione dove serve)
    }
  }
}
applyRiskOverrides();   // gli override del CEO valgono da subito, prima di qualunque calcolo
/* SYNC CLOUD dei parametri di rischio (v150) — stesso pattern di diario/override macro.
   Prima vivevano SOLO in localStorage ("salvata su questo browser"): il cap 20% del CEO sul
   Mac restava 10% su iPhone → lo STESSO bottone 📋 generava payload DIVERSI per device
   (candidati 3 vs 4, riga cap diversa). Trovato eseguendo il prompt su me stesso (harness
   senza localStorage = il "device nuovo"). Chiave _savedAt = merge whole-object: vince il
   più recente; applyRiskOverrides la ignora (accetta solo numeri in banda). */
const RISK_PARAMS_PATH = "config/risk_params.json";
async function pushRiskParamsCloud(ov) {
  const token = localStorage.getItem("gh_token");
  if (!token) return;
  try {
    let sha;
    const g = await fetch(`https://api.github.com/repos/${REPO}/contents/${RISK_PARAMS_PATH}`, { headers: ghHeaders(token), cache: "no-store" });
    if (g.ok) sha = (await g.json()).sha;
    await fetch(`https://api.github.com/repos/${REPO}/contents/${RISK_PARAMS_PATH}`, {
      method: "PUT", headers: ghHeaders(token),
      body: JSON.stringify({ message: "Parametri di rischio (da dashboard)", content: btoa(unescape(encodeURIComponent(JSON.stringify(ov, null, 1)))), sha }),
    });
  } catch { /* offline: resta in locale */ }
}
async function loadRiskParamsCloud() {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${RISK_PARAMS_PATH}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const cloud = await r.json();
    if (!cloud || typeof cloud !== "object") return;
    let local = {};
    try { local = JSON.parse(localStorage.getItem("risk_params_overrides") || "{}"); } catch { local = {}; }
    if ((cloud._savedAt || "") > (local._savedAt || "")) {
      localStorage.setItem("risk_params_overrides", JSON.stringify(cloud));
      applyRiskOverrides();
      if (typeof DATA !== "undefined" && DATA) renderAll();
    }
  } catch { /* nessun file remoto */ }
}

/* beta effettivo di un titolo: PRIORITÀ alla regressione della pipeline sui log-rendimenti
   12M vs Nasdaq 100 (beta_ndx); fallback al beta Yahoo (5A mensile vs S&P) solo se manca. */
function betaOf(r) {
  if (r.beta_ndx != null) return r.beta_ndx;
  if (r.ticker === "BTP-V28") return 0;   // esposizione azionaria nulla
  return r.beta ?? null;
}


/* Rischio cambio EUR/USD: quota % del NAV (investito + liquidità EUR) denominata in USD
   e NON coperta — un apprezzamento dell'euro erode i guadagni in dollari a parità di prezzi. */
function fxExposure() {
  const inv = (DATA?.portfolio || []).filter(r => (r.val_eur || 0) > 0);
  const nav = inv.reduce((s, r) => s + r.val_eur, 0) + cashEur;
  if (!nav) return null;
  const usdEur = inv.filter(r => r.currency === "USD").reduce((s, r) => s + r.val_eur, 0);
  return { pct: Math.round(usdEur / nav * 1000) / 10, usdEur, nav, eurusd: DATA?.eurusd ?? null };
}

/* rischio liquidità/slippage: la posizione vale più del 5% del volume medio giornaliero in $
   (uscire muoverebbe il prezzo). Usa avg_volume_30d dalle stats; solo posizioni possedute. */
function isIlliquid(r) {
  const st = r.stats || {};
  if (!r.qty || !r.price || !st.avg_volume_30d) return false;
  const posValueUsd = r.qty * r.price;               // controvalore posizione in $
  const advUsd = st.avg_volume_30d * r.price;         // dollar volume medio giornaliero
  return advUsd > 0 && posValueUsd / advUsd > 0.05;
}

/* peso % di una posizione sul NAV (investito + liquidità) — per la regola di sizing 10% */
function positionWeightPct(r) {
  const t = DATA?.totals || {};
  const nav = (t.eur_invested || 0) + cashEur;
  if (!nav) return null;
  // val_eur lo setta recomputeTotals; se per una race non è ancora presente su una posizione
  // DETENUTA (qty>0), ricavalo da prezzo×qty (mirror di recomputeTotals). Senza questo fallback
  // positionWeightPct tornava null e il CAP GATE dell'accumulo (w != null && w ≥ cap) falliva
  // APERTO: un nome già oltre il 10% NAV (es. AMD 14,7% nello snapshot) sfuggiva alla soglia e
  // finiva TRA I CANDIDATI, in aperta violazione di B3 "Let Winners Run". Watchlist (no qty) →
  // resta null → passa il gate (peso 0, corretto).
  let ve = r.val_eur;
  if (!(ve > 0) && r.qty && r.price != null) {
    const eurusd = DATA.eurusd || 1.08;
    ve = r.currency === "EUR" ? (r.value || r.price * r.qty) : (r.price * r.qty) / eurusd;
  }
  if (!(ve > 0)) return null;
  return Math.round(ve / nav * 1000) / 10;
}

/* VETO del risk manager (non scavalcabile da alcun supporto tecnico):
   - VALUE TRAP se, anche singolarmente: Sharpe 1A < -0.3 · Short Interest ≥ 15% ·
     margine netto negativo con PEG non calcolabile/negativo.
     (soglia -0.3 e non 0: uno Sharpe lievemente negativo in un mercato in drawdown è rumore,
     sotto -0.3 è distruzione sistematica di valore corretto per il rischio)
   - NON ACCUMULARE se ROIC/ROE < 0 o PEG < 0 (qualità del capitale rotta).
   - RIABILITAZIONE GROWTH (v111): il Sortino 12M guarda INDIETRO — dopo un crash marchia
     VALUE TRAP proprio i titoli di qualità in recupero, quando un fondo growth dovrebbe
     poterli ricomprare. Il veto Sortino (e SOLO quello) è revocato se il titolo prova la
     ripresa su TRE assi insieme, tutti meccanici:
       qualità intatta (ROE > 15% E margine netto > 0) · trend riparato (prezzo sopra
       SMA200) · forza relativa 1M vs NDX positiva (batte il benchmark del mandato ORA).
     Short interest alto e margini negativi NON sono riabilitabili: sono rischio presente,
     non cicatrici del passato. Il riabilitato resta un SORVEGLIATO: viene dichiarato. */
/* TURNAROUND SQUEEZE (v113): un titolo VETATO in caduta ma con risveglio istituzionale
   violento — Short Interest ≥ 20% + RVol > 2 (flussi anomali) + prezzo sopra SMA50
   (struttura in riparazione) — non va scartato in silenzio: è un setup speculativo
   asimmetrico che il CEO deve VEDERE, dichiarato come tale (sizing dimezzato, stop
   stretto 1×ATR). Solo watchlist: su una posizione detenuta non è un'idea d'ingresso.
   Il veto del mandato growth RESTA: questo è un tag informativo, non una promozione. */
function squeezeSetup(r) {
  const st = r.stats || {};
  return !r.qty && st.short_float != null && st.short_float >= 0.20 &&
    r.vol_ratio != null && r.vol_ratio > 2.0 &&
    r.sma50_dist_pct != null && r.sma50_dist_pct > 0;
}

function qualityVeto(r) {
  const st = r.stats || {};
  const why = [];
  // metro del veto: SORTINO (downside deviation) — punisce la distruzione di valore reale,
  // non i rally; un titolo volatile al rialzo non finisce in value trap per lo Sharpe basso.
  // Fallback etichettato allo Sharpe finché la pipeline non popola sortino_1y.
  let downside = null;
  if (r.sortino_1y != null) {
    if (r.sortino_1y < RISK_PARAMS.sortinoVeto) downside = `Sortino 1A ${fmtNum.format(r.sortino_1y)} < ${RISK_PARAMS.sortinoVeto} (distruzione di valore sul downside)`;
  } else if (r.sharpe_1y != null && r.sharpe_1y < RISK_PARAMS.sortinoVeto) {
    downside = `Sharpe 1A ${fmtNum.format(r.sharpe_1y)} < ${RISK_PARAMS.sortinoVeto} (proxy: Sortino n.d. fino al prossimo run pipeline)`;
  }
  if (st.short_float != null && st.short_float >= 0.15) why.push(`Short Interest ${Math.round(st.short_float * 1000) / 10}% ≥ 15%`);
  const pegBroken = st.peg == null || st.peg <= 0;   // la pipeline azzera già i PEG ≤ 0 → n.d.
  if (st.profit_margin != null && st.profit_margin < 0 && pegBroken) why.push("margine netto negativo con PEG non calcolabile");
  if (downside) {
    const rsNow = r.rs_ndx_1m ?? r.rs_1m;
    const rehab = !why.length &&
      st.roe != null && st.roe > 0.15 &&
      st.profit_margin != null && st.profit_margin > 0 &&
      r.sma200_dist_pct != null && r.sma200_dist_pct > 0 &&
      rsNow != null && rsNow > 0;
    if (rehab) return {
      verdict: "RIABILITATO (growth)", rehab: true, why: [downside],
      rehabWhy: `ROE ${Math.round(st.roe * 100)}% · ${signTxt(Math.round(r.sma200_dist_pct * 10) / 10)} vs SMA200 · RS 1M vs NDX ${signTxt(Math.round(rsNow * 10) / 10, "pp")}${r.sharpe_6m != null ? ` · Sharpe 6M ${fmtNum.format(r.sharpe_6m)} (finestra di regime)` : ""}`,
    };
    why.unshift(downside);
  }
  if (why.length) {
    // GRADAZIONE DEL VETO (v144): il muro di "SCARTATO" identici nasconde la differenza tra un
    // Sortino -2,7 STRUTTURALE e un -0,4 che una brutta settimana ha spinto sotto soglia. Un veto
    // è DEBOLE se è guidato SOLO dal downside e resta entro ~2,5× la soglia (borderline, spesso
    // ciclico → l'LLM può superarlo con tesi più facilmente); FORTE se profondo o con short/margini.
    const sortinoOnly = downside && why.length === 1;
    const deep = r.sortino_1y != null ? r.sortino_1y <= RISK_PARAMS.sortinoVeto * 2.5 : true;
    const strength = (sortinoOnly && !deep) ? "debole" : "forte";
    // v200: l'etichetta "SCARTATO - VALUE TRAP" era un verdetto travestito da dato. La misura
    // (il Sortino, lo short interest, il ROE) e' un fatto; "value trap" e' una conclusione, e le
    // conclusioni sono il mestiere di chi legge. Resta il FILTRO, sparisce la sentenza.
    return { verdict: "NON SUPERA IL FILTRO QUALITÀ", why, strength };
  }
  if (st.roe != null && st.roe < 0) return { verdict: "NON ACCUMULARE", why: ["ROIC/ROE negativo"], strength: "forte" };
  if (st.peg != null && st.peg < 0) return { verdict: "NON ACCUMULARE", why: ["PEG negativo"], strength: "forte" };
  return null;
}

function decisionVerdict() {
  const t = DATA.totals || {};
  const dir = marketDirectionScore();
  const eurusd = DATA.eurusd || 1.08;
  const ps = t.portfolio_sharpe_ratio;
  const universe = [...(DATA.portfolio || []), ...(DATA.watchlist || [])].filter(isEquity);

  // 1) VETO fondamentale: value trap e qualità rotta escluse a prescindere dal drawdown.
  //    I RIABILITATI (veto Sortino revocato dalla regola growth) tornano eleggibili ma
  //    restano dichiarati come sorvegliati: trailing negativo, ripresa provata.
  const excluded = [];
  const eligible = [];
  const rehabbed = [];
  universe.forEach(r => {
    const v = qualityVeto(r);
    if (v && v.rehab) { rehabbed.push({ r, ...v }); eligible.push(r); }
    else if (v) excluded.push({ r, ...v, squeeze: squeezeSetup(r) });
    else eligible.push(r);
  });
  // setup speculativi TURNAROUND SQUEEZE tra gli esclusi (v113): esposti, non promossi
  const squeezed = excluded.filter(x => x.squeeze);

  // 2) score quant 0-100 sui soli eleggibili: impatto marginale sullo Sharpe (40%),
  //    forza relativa 1M vs benchmark/NDX (30%), qualità fondamentale (30%).
  //    Per i RIABILITATI la componente Sharpe usa la finestra 6M quando disponibile (v112):
  //    il 12M resta contaminato dal crash per mesi e schiaccerebbe lo score proprio dei
  //    titoli che la regola growth ha appena riammesso — il 6M misura il regime corrente.
  const rehabSet = new Set(rehabbed.map(x => x.r.ticker));
  // v164: il fallback silenzioso a 1 era doppiamente dannoso — (a) stampava "vs 1 attuale" mentre
  // la riga di sintesi dello stesso payload diceva "Sharpe —", (b) ricalibrava la componente 40%
  // dello score su una baseline INVENTATA (nello scenario di prova i candidati passavano da 4 a 8).
  // Ora resta null: lo score esclude la componente Sharpe e rinormalizza sugli altri pesi.
  const refSharpe = ps != null ? ps : null;   // baseline: Sharpe attuale del portafoglio (null = n.d.)
  const quantScore = (r) => {
    const st = r.stats || {};
    const parts = [];
    const shBase = rehabSet.has(r.ticker) && r.sharpe_6m != null ? r.sharpe_6m : r.sharpe_1y;
    if (shBase != null && refSharpe != null) parts.push([clamp(50 + (shBase - refSharpe) * 25), .40]);
    // forza relativa: metro diretto del mandato = RS vs NDX (fallback sul benchmark settoriale)
    const rsq = r.rs_ndx_1m ?? r.rs_1m;
    if (rsq != null) parts.push([clamp(50 + rsq * 4), .30]);
    let q = 50;
    if (st.roe != null) q += clamp(st.roe * 120, -30, 30);
    if (st.profit_margin != null) q += clamp(st.profit_margin * 60, -15, 15);
    if (st.revenue_growth != null) q += clamp(st.revenue_growth * 40, -10, 15);
    if (r.fin_health != null) q = (q + r.fin_health) / 2;
    parts.push([clamp(q), .30]);
    const wTot = parts.reduce((s, p) => s + p[1], 0) || 1;
    return Math.round(parts.reduce((s, p) => s + p[0] * p[1], 0) / wTot);
  };

  // candidati ACCUMULO: migliorano il profilo rischio/rendimento (score ≥ minScore) e hanno
  // Sharpe noto. Il drawdown non è più la porta d'ingresso: è solo un tiebreaker di prezzo.
  // CAP D'INGRESSO (#1, direttiva CEO v121): una posizione GIÀ ≥ capNoAdd_pct del NAV non può
  // ricevere NUOVI acquisti — il cap rigido vale SOLO sull'accumulo, mai come trim forzato.
  const overCap = [];
  const accumula = eligible
    .filter(r => r.price && r.sharpe_1y != null)
    .filter(r => {
      const w = positionWeightPct(r);
      if (w != null && w >= RISK_PARAMS.capNoAdd_pct) { overCap.push({ r, w }); return false; }
      return true;
    })
    .map(r => ({ ...r, _q: quantScore(r) }))
    .filter(r => r._q >= RISK_PARAMS.minScore)
    .sort((a, b) => (b._q - a._q) || ((a.w52_dist_pct ?? 0) - (b.w52_dist_pct ?? 0)));

  // 3) CONCENTRAZIONE SINGOLO TITOLO (#1, direttiva CEO v121): NESSUN trim automatico su ciò che
  // è cresciuto per apprezzamento organico — "Let Winners Run", la protezione è lo stop ratchet
  // 2×ATR. Solo un ALERT informativo se un nome supera capAlert_pct (25%) del NAV. Le posizioni
  // tra capNoAdd (10%) e capAlert (25%) corrono libere: niente trim, niente allarme.
  const concentrationAlert = (DATA.portfolio || []).filter(isEquity)
    .map(r => ({ r, w: positionWeightPct(r) }))
    .filter(x => x.w != null && x.w > RISK_PARAMS.capAlert_pct)
    .sort((a, b) => b.w - a.w);
  // alleggerimenti tattici: multipli NON GIUSTIFICATI dalla crescita o ipercomprato estremo
  // (solo posizioni possedute). Mandato growth "let winners run" (v111): un P/E ottico alto
  // con PEG ≤ 2 è crescita pagata al prezzo giusto, non un motivo di trim — si trimma quando
  // anche la crescita non copre il multiplo (PEG > 2 o non calcolabile) o l'RSI è estremo.
  const trim = (DATA.portfolio || []).filter(isEquity)
    .filter(r => {
      const peg = r.stats?.peg;
      const unjustified = r.pe && r.pe > 150 && !(peg > 0 && peg <= 2);
      return r.qty && (unjustified || (r.rsi && r.rsi > 78));
    })
    .sort((a, b) => (b.pe || 0) - (a.pe || 0));
  // TAX ALPHA: posizioni in perdita latente con veto qualità → minusvalenze come scudo fiscale
  // (i riabilitati NON sono candidati harvest: la regola growth dice tenerli, non venderli)
  const harvest = (DATA.portfolio || []).filter(isEquity)
    .filter(r => {
      const v = r.qty && r.gain_eur != null && r.gain_eur < 0 ? qualityVeto(r) : null;
      return v && !v.rehab;
    })
    .sort((a, b) => a.gain_eur - b.gain_eur);

  // 4) piano operativo: ordini limite al supporto, stop a 2×ATR (volatilità, non % fissa)
  // ALLINEAMENTO LOGICO v124: il sizing degli ingressi usa la STESSA base del budget dichiarato
  // al prompt — il BUDGET OPERATIVO SPENDIBILE (cassa − ES95, riserva tail-risk inviolabile),
  // non la cassa piena. Prima il motore dimensionava su cashUsd intero mentre la testata diceva
  // all'LLM "spendibile = cassa − ES95": le quantità suggerite potevano sforare la riserva.
  // Ora coincidono: le due metriche di base sono la stessa.
  const es95Eur = t.es95_hist_eur ?? t.es95_1d_eur ?? 0;
  const budgetOpEur = t.budget_operativo_spendibile != null ? t.budget_operativo_spendibile : Math.max(0, cashEur - es95Eur);
  const budgetOpUsd = budgetOpEur * eurusd;   // base di sizing = budget operativo (post riserva ES95)
  // sizing regime-aware: i budget d'ingresso si riducono quando la volatilità di mercato
  // sale (VIX) — stessa logica degli stop ATR ma a livello di PORTAFOGLIO: in regime
  // nervoso si rischia meno per operazione, non si spegne il motore.
  const vixV = (DATA.macro || {}).vix?.value;
  const riskScale = vixV == null ? 1 : vixV > 30 ? 0.4 : vixV > 25 ? 0.5 : vixV > 20 ? 0.75 : 1;
  const withPlan = accumula.map((r, i) => {
    // MAI il range del GRAFICO negli ordini (v115): sparkRange è una preferenza di
    // visualizzazione — con "1A" selezionato il piano pescava il minimo di un anno fa
    // (SNDK limite $40,1 su quotazione $1915, stop -$366). saneEntryLimit usa solo
    // supporti RECENTI in banda ±25% dal prezzo, con fallback dichiarato SMA50/ATR/-5%.
    const pick = saneEntryLimit(r) || { limit: r.price, src: "prezzo", fallback: false };
    const limit = Math.min(pick.limit, r.price);
    const budget = budgetOpUsd * (i === 0 ? 0.35 : i === 1 ? 0.25 : 0.15) * riskScale;
    const qty = limit > 0 ? Math.floor(budget / limit) : 0;
    const st = atrStop(limit, r);
    return { r, limit, qty, dd: r.w52_dist_pct, q: r._q, stop: st ? st.stop : Math.round(limit * 0.92 * 100) / 100, atr: st,
             limitSrc: pick.src, limitFallback: pick.fallback };
  }).filter(x => x.qty > 0 && x.limit > 0 && x.stop > 0 && x.stop < x.limit);
  // stop TRAILING sulle posizioni esistenti: ratchet pipeline (stopOf) — sale, non ridiscende
  const trailing = (DATA.portfolio || []).filter(isEquity).filter(r => r.qty && r.price)
    .map(r => {
      const st = stopOf(r);
      return st ? { r, stop: st.stop, violated: st.violated, ratchet: st.ratchet, atr: st } : null;
    }).filter(Boolean);
  const stopViolations = trailing.filter(x => x.violated);

  const reasons = [];
  let label, score, col;
  // il veto su una POSIZIONE detenuta significa "non incrementare", non "vendi subito":
  // senza il distinguo l'LLM leggeva "META SCARTATO - VALUE TRAP" su un titolo in portafoglio
  // e doveva indovinare se fosse un ordine di vendita (v110). Tag corto + legenda unica in coda.
  const vetoTk = excluded.map(x => `${x.r.ticker}${x.r.qty ? " [in ptf]" : ""} (${x.verdict === "SCARTATO - VALUE TRAP" ? "VALUE TRAP" : x.why[0]}${x.strength ? `, veto ${x.strength.toUpperCase()}` : ""})`);
  const vetoHeldNote = excluded.some(x => x.r.qty)
    ? " ([in ptf] = posizione detenuta: il veto vieta l'ACCUMULO, la decisione tenere/vendere resta aperta)" : "";
  // COERENZA CASSA↔VERDETTO (v123): il ramo ACCUMULA scatta solo se c'è ALMENO UN ORDINE
  // ESEGUIBILE (withPlan non vuoto). Prima il gate era `cashUsd > 0`: con cassa a 0 (o troppo
  // piccola per 1 azione) il verdetto cadeva in MANTIENI stampando "nessun candidato migliora
  // abbastanza" — FALSO, i candidati esistevano (accumula.length>0). Ora i tre stati sono
  // distinti: (a) candidati + cassa → ACCUMULA · (b) candidati MA cassa esaurita → segnala
  // l'opportunità bloccata dalla liquidità · (c) davvero nessun candidato → MANTIENI/PRUDENZA.
  if (accumula.length >= 1 && withPlan.length > 0) {
    label = "ACCUMULA"; col = "var(--green)"; score = 72;
    reasons.push(`${accumula.length} candidati migliorano il profilo Sharpe/RS del portafoglio (score quant ≥${RISK_PARAMS.minScore}): ${accumula.slice(0, 8).map(r => `${r.ticker} ${r._q}/100`).join(", ")}${accumula.length > 8 ? ", …" : ""}`);
    reasons.push(refSharpe != null
      ? `criteri: impatto marginale sullo Sharpe (vs ${fmtNum.format(refSharpe)} attuale, target 2.0) · forza relativa 1M vs benchmark · qualità fondamentale`
      : `criteri: forza relativa 1M vs benchmark · qualità fondamentale — ⚠ lo Sharpe di portafoglio non è disponibile in questo run: la componente Sharpe (40% dello score) è ESCLUSA e i pesi rinormalizzati, quindi il ranking è meno informativo del solito`);
    reasons.push(`ordini LIMITE ai supporti con stop a 2×ATR(14): il rischio per operazione si adatta alla volatilità del titolo`);
    if (riskScale < 1) reasons.push(`regime di volatilità: VIX ${fmtNum.format(vixV)} → budget d'ingresso ridotti al ${Math.round(riskScale * 100)}% (sizing regime-aware: in mercato nervoso si rischia meno per operazione)`);
  } else if (accumula.length >= 1) {
    // candidati PRONTI ma nessun ordine eseguibile: la liquidità è il collo di bottiglia, NON la mancanza di idee
    label = "LIQUIDITÀ"; col = "var(--yellow)"; score = 50;
    reasons.push(`⚠ ${accumula.length} candidati d'ingresso PRONTI (${accumula.slice(0, 5).map(r => `${r.ticker} ${r._q}/100`).join(", ")}${accumula.length > 5 ? ", …" : ""}) MA liquidità esaurita (cassa ${fmtEUR.format(cashEur)}${t.budget_operativo_spendibile != null ? `, budget operativo ${fmtEUR.format(Math.round(t.budget_operativo_spendibile))}` : ""}): nessun ingresso ESEGUIBILE oggi. Non è "niente da comprare" — è "niente con cui comprare". Per attivarli, libera cassa: trim tattico, uscita dai nomi in veto (es. MSTR), o nuovo versamento.`);
  } else if (overCap.length) {
    // v164 — TERZO COLLO DI BOTTIGLIA (simmetrico a LIQUIDITÀ): i candidati esistevano e passavano
    // lo score, li ha fermati il CAP D'INGRESSO. Dirlo "nessun candidato migliora abbastanza" era
    // una diagnosi FALSA e opposta alla realtà ("c'è un buon nome, ma è già troppo pesante").
    label = "CAP"; col = "var(--yellow)"; score = 50;
    reasons.push(`⚠ nessun ingresso possibile per CAP D'INGRESSO, non per mancanza di idee: ${overCap.map(x => `${x.r.ticker} (${fmtNum.format(x.w)}%)`).join(", ")} ${overCap.length > 1 ? "superano" : "supera"} già il ${fmtNum.format(RISK_PARAMS.capNoAdd_pct)}% del NAV. Non è "niente di buono da comprare" — è "il buono che vedo lo ho già, e in dose piena". Le vie aperte restano: lasciar correre (Let Winners Run, protetto dal ratchet), alzare il cap DICHIARANDOLO, o cercare fuori dal book nomi a bassa correlazione.`);
  } else if (dir != null && dir < 40) {
    label = "PRUDENZA"; col = "var(--yellow)"; score = 32;
    reasons.push(`regime debole (segnali ${dir}/100) e nessun candidato con edge quant: nessun nuovo ingresso, disciplina sugli stop 2×ATR`);
  } else {
    label = "MANTIENI"; col = "var(--blue)"; score = dir != null ? dir : 55;
    reasons.push(`nessun candidato migliora abbastanza Sharpe/forza relativa (regime ${dir != null ? dir + "/100" : "neutro"}): conserva liquidità e posizioni vincenti`);
  }
  /* v247 — RIMOSSO da `reasons`: il cap d'ingresso. */
  if (stopViolations.length) reasons.unshift(`⚠ STOP VIOLATO su ${stopViolations.map(x => `${x.r.ticker} (stop $${fmtNum.format(x.stop)}, prezzo $${fmtNum.format(x.r.price)})`).join(", ")} — il prezzo è sotto lo stop trailing ancorato`);   // v247: resta il FATTO, via la prescrizione
  /* v247 — RIMOSSO da `reasons`: il VETO risk manager. */
  /* v247 — RIMOSSO da `reasons`: i RIABILITATI. */
  /* v247 — RIMOSSO da `reasons`: la prescrizione dello squeeze. */
  // v167 — CONCENTRAZIONE DI FATTORE (la soglia che mancava). Il veto qualità giudica UN TITOLO
  // alla volta ed è cieco alle correlazioni: dieci nomi con Sortino accettabile possono scendere
  // insieme se condividono il fattore. Qui si somma l'MCR — la quota di VARIANZA, non il peso —
  // per settore, col bucket "Semiconduttori/memoria" che è il fattore vero di questo book.
  // Solo segnalazione, coerente con "indicatori non dettami": nessun trim automatico.
  const factorRisk = (() => {
    const by = new Map();
    for (const r of (DATA.portfolio || []).filter(isEquity)) {
      const m = dgFin(r.risk_contrib_pct);
      if (m == null) continue;
      const k = thIsSemi(r) ? "Semiconduttori/memoria" : (r.sector || "Altro");
      const cur = by.get(k) || { mcr: 0, w: 0, tk: [] };
      cur.mcr += m; cur.w += (positionWeightPct(r) ?? 0); cur.tk.push(r.ticker);
      by.set(k, cur);
    }
    const top = [...by.entries()].sort((a, b) => b[1].mcr - a[1].mcr)[0];
    return top ? { name: top[0], ...top[1] } : null;
  })();
  if (factorRisk && factorRisk.mcr > RISK_PARAMS.factorRiskAlert_pct) {
    reasons.push(`CONCENTRAZIONE DI FATTORE: ${factorRisk.tk.join("+")} (${factorRisk.name}) generano il ${fmtNum.format(Math.round(factorRisk.mcr * 10) / 10)}% della VARIANZA del fondo con il ${fmtNum.format(Math.round(factorRisk.w * 10) / 10)}% del NAV. Il veto qualità guarda un titolo per volta e questo NON lo vede: sono nomi che possono scendere INSIEME perché condividono il fattore, per quanto sani siano singolarmente`);   /* v247 — la MISURA resta: è la sola che dice quando N posizioni sono in realtà una sola. Via la soglia superata e l'invito a diversificare, che erano il verdetto */
  }
  /* v247 — RIMOSSO da `reasons`: l'alert su singolo nome. */
  // motivo PRECISO per titolo (non il generico "multiplo/RSI estremo": su CBRS scattava solo
  // il multiplo e l'LLM segnalava "RSI 43,6 non estremo" — v118)
  /* v247 — RIMOSSO da `reasons`: il TRIM parziale era una raccomandazione operativa esplicita. */
  return { label, col, score, reasons, dir, accumula, trim, withPlan, trailing, stopViolations, excluded, rehabbed, squeezed, overCap, concentrationAlert, factorRisk, harvest };
}

/* ═══ PARAMETRI DI RISCHIO DEL FONDO (v122) — regole attive lette in tempo reale ═══
   Registro DICHIARATIVO: ogni regola = soglia (da RISK_PARAMS) + stato LIVE calcolato dai
   dati correnti. Tier per impatto: red = protezione del capitale, yellow = dimensionamento,
   green = segnali. Un'unica fonte per la card e il popup. */
function topEquitySectorPct() {
  const allocR = (DATA.allocation || []).filter(a => a.sector !== "Liquidità" && a.sector !== "Obbligazioni");
  const bySec = {};
  allocR.forEach(a => { const k = a.sector || a.ticker; bySec[k] = (bySec[k] || 0) + (a.value_eur || 0); });
  const tot = Object.values(bySec).reduce((s, v) => s + v, 0) || 1;
  const top = Object.entries(bySec).sort((a, b) => b[1] - a[1])[0];
  return top ? { name: top[0], pct: Math.round(top[1] / tot * 100) } : null;
}
function riskRulesRegistry() {
  const t = DATA.totals || {};
  let dv = {}; try { dv = decisionVerdict(); } catch { dv = {}; }
  const ptf = (DATA.portfolio || []).filter(isEquity);
  const allEq = [...ptf, ...(DATA.watchlist || []).filter(isEquity)];
  const es95 = t.es95_hist_eur ?? t.es95_1d_eur;
  const budget = t.budget_operativo_spendibile;
  const vix = (DATA.macro || {}).vix?.value;
  const rScale = vix == null ? 1 : vix > 30 ? 0.4 : vix > 25 ? 0.5 : vix > 20 ? 0.75 : 1;
  const sec = topEquitySectorPct();
  const maxCorr = Math.max(0, ...ptf.map(r => r.max_corr ?? 0));
  const trimTac = ptf.filter(r => r.qty && ((r.pe && r.pe > 150 && !(r.stats?.peg > 0 && r.stats.peg <= 2)) || (r.rsi && r.rsi > 78)));
  const altman = allEq.filter(r => r.stats?.altman_z != null && r.stats.altman_z < 1.81);
  const earn = ptf.filter(r => earningsRiskDays(r) != null);
  const eur = (v) => v == null ? "n.d." : fmtEUR.format(Math.round(v));
  const nOv = (dv.overCap || []).length, nAl = (dv.concentrationAlert || []).length, nVeto = (dv.excluded || []).length;
  const nAcc = (dv.accumula || []).length, nReh = (dv.rehabbed || []).length, nSq = (dv.squeezed || []).length;
  const nStopV = (dv.stopViolations || []).length, nTrail = (dv.trailing || []).length;
  return [
    // 🔴 RED — protezione del capitale / gate rigidi
    { tier: "red", label: "Cap d'ingresso", th: `${RISK_PARAMS.capNoAdd_pct}% NAV`, active: nOv > 0,
      state: `${nOv} posizioni ≥${RISK_PARAMS.capNoAdd_pct}% NAV: divieto di NUOVI acquisti (si lasciano correre)`,
      why: `Un singolo nome non deve poter crescere OLTRE il ${RISK_PARAMS.capNoAdd_pct}% del NAV con capitale FRESCO (rischio idiosincratico d'ingresso). Ciò che supera il cap per apprezzamento organico NON viene trimmato — Let Winners Run, protetto dallo stop ratchet.`, where: "motore (decisionVerdict)" },
    { tier: "red", label: "Veto Value Trap", th: `Sortino 1A < ${RISK_PARAMS.sortinoVeto}`, active: nVeto > 0,
      state: `${nVeto} titoli in veto (Sortino<${RISK_PARAMS.sortinoVeto} · Short≥15% · margine neg+PEG rotto)`,
      why: "Divieto di ACCUMULO su titoli che distruggono valore corretto per il rischio (downside deviation) o con short interest da squeeze. Non media al ribasso sul coltello che cade. Il veto vieta l'accumulo, non impone la vendita.", where: "motore (qualityVeto)" },
    { tier: "red", label: "Riserva tail-risk ES95", th: `budget = cassa − ES95`, active: true,
      state: `ES95 ${eur(es95)} accantonato · budget operativo ${eur(budget)}`,
      why: "La perdita MEDIA nel 5% dei giorni peggiori resta intoccabile: protegge l'INTERO portafoglio da un crollo di mercato senza cappare i vincenti. Confermata dal CEO.", where: "pipeline (totals)" },
    { tier: "red", label: "Stop ratchet 2×ATR", th: `trailing, sale e non scende`, active: nStopV > 0,
      state: nStopV > 0 ? `⚠ ${nStopV} STOP VIOLATI su ${nTrail} posizioni` : `${nTrail} stop attivi, nessuno violato`,
      why: "Stop dinamico a 2×ATR(14) sotto il prezzo, ancorato: sale coi massimi e non ridiscende. È la difesa principale su ogni posizione — sostituisce il cap sizing come protezione dei vincenti.", where: "pipeline (ratchet_stops)" },
    // 🟡 YELLOW — dimensionamento / esecuzione
    { tier: "yellow", label: "Alert concentrazione", th: `singolo nome > ${RISK_PARAMS.capAlert_pct}% NAV`, active: nAl > 0,
      state: nAl > 0 ? `⚠ ${nAl} nomi oltre il 25% NAV` : `nessun nome oltre il 25% NAV`,
      why: "Avviso di rischio idiosincratico quando un singolo titolo supera il 25% del NAV. È un promemoria per una scelta consapevole, MAI un obbligo di trim (Let Winners Run).", where: "motore (decisionVerdict)" },
    { tier: "green", label: "Concentrazione settore (capitale)", th: `contesto, > ${Math.round(RISK_PARAMS.sectorAlert_frac * 100)}% = estrema`, active: !!(sec && sec.pct > RISK_PARAMS.sectorAlert_frac * 100),
      state: sec ? `${sec.name} ${sec.pct}% del capitale azionario` : "n.d.",
      why: "Quota di CAPITALE nel primo settore. È contesto, non l'allarme di concentrazione: quello lo dà la CONCENTRAZIONE DI FATTORE, che somma gli MCR e ragiona sulla VARIANZA — la grandezza che determina quanto fa male una giornata storta. Su questo book le due divergono molto (56% di NAV in semi = 86% del rischio).", where: "motore + pipeline (allocation)" },
    { tier: "yellow", label: "Score minimo d'accumulo", th: `≥ ${RISK_PARAMS.minScore}/100`, active: nAcc > 0,
      state: `${nAcc} candidati con edge quant ≥${RISK_PARAMS.minScore}`,
      why: "Solo i titoli il cui score (impatto marginale sullo Sharpe 40% · forza relativa 1M 30% · qualità fondamentale 30%) supera 60 entrano nel piano d'accumulo.", where: "motore (quantScore)" },
    { tier: "yellow", label: "Regime sizing VIX", th: `×0,75/0,5/0,4 a VIX>20/25/30`, active: rScale < 1,
      state: vix != null ? `VIX ${fmtNum.format(vix)} → budget d'ingresso ×${rScale}` : "VIX n.d.",
      why: "In mercato nervoso si rischia meno per operazione: il budget d'ingresso si riduce all'aumentare della volatilità implicita, senza spegnere il motore.", where: "motore (decisionVerdict)" },
    { tier: "yellow", label: "Riabilitazione growth", th: `ROE>15% + >SMA200 + RS>0`, active: nReh > 0,
      state: nReh > 0 ? `${nReh} titoli riabilitati (sorvegliati)` : "nessuna riabilitazione attiva",
      why: "Revoca il veto Sortino a un leader in recupero: il Sortino 12M guarda indietro e penalizza chi si sta riprendendo. Il riabilitato torna eleggibile ma resta SORVEGLIATO (trailing negativo dichiarato).", where: "motore (qualityVeto)" },
    { tier: "yellow", label: "Paracadute limite d'ordine", th: `supporto entro ±25% dal prezzo`, active: false,
      state: "attivo su ogni ordine d'ingresso",
      why: "Un limite d'acquisto più lontano del 25% dal prezzo non è un ordine ma un residuo di dato sporco: scatta un fallback dichiarato (SMA50 → 2×ATR → -5%). Nato dall'incidente SNDK.", where: "motore (saneEntryLimit)" },
    // 🟢 GREEN — segnali informativi
    { tier: "green", label: "Turnaround squeeze", th: `short≥20% + RVol>2 + >SMA50`, active: nSq > 0,
      state: nSq > 0 ? `${nSq} setup speculativi esposti` : "nessun setup squeeze",
      why: "Un titolo vetato ma con risveglio istituzionale improvviso viene esposto come speculazione asimmetrica dichiarata (sizing dimezzato, stop 1×ATR), mai promosso a investimento del mandato.", where: "motore (squeezeSetup)" },
    { tier: "green", label: "Trim tattico valutazione", th: `P/E>150 non giust. o RSI>78`, active: trimTac.length > 0,
      state: trimTac.length > 0 ? `${trimTac.map(r => r.ticker).join(", ")} (multiplo/ipercomprato)` : "nessuno",
      why: "Segnala multipli non giustificati dalla crescita (P/E>150 con PEG fuori scala) o ipercomprato estremo (RSI>78) come candidati opzionali a un free-ride. Non è un obbligo.", where: "motore (decisionVerdict)" },
    { tier: "green", label: "Rischio default (Altman)", th: `Altman Z'' < 1,81`, active: altman.length > 0,
      state: altman.length > 0 ? `${altman.map(r => r.ticker).join(", ")}` : "nessun titolo in distress",
      why: "Flag prudenziale di solidità di bilancio (Altman Z'' non-manifatturieri): sotto 1,81 il titolo è nella zona grigia di rischio insolvenza. Solo segnalazione.", where: "pipeline (stats.altman_z)" },
    { tier: "green", label: "Earnings imminenti", th: `trimestrale < 14 giorni`, active: earn.length > 0,
      state: earn.length > 0 ? `${earn.map(r => r.ticker).join(", ")}` : "nessuna trimestrale <14gg",
      why: "Rischio evento binario: il gap post-earnings può scavalcare stop e supporti. Su un candidato d'ingresso impone la scelta esplicita ingresso post-evento o sizing ridotto.", where: "pipeline (earnings_date)" },
    { tier: "green", label: "Correlazione fra posizioni", th: `coppia > 0,75`, active: maxCorr > 0.75,
      state: `correlazione max in portafoglio ${fmtNum.format(Math.round(maxCorr * 100) / 100)}`,
      why: "Due posizioni troppo correlate non diversificano: la soglia 0,75 segnala quando la diversificazione apparente è illusoria. Oggi la coppia più correlata è sotto soglia.", where: "pipeline (matrice correlazioni)" },
  ];
}
const RP_TIER = { red: { c: "var(--red)", lab: "Protezione capitale" }, yellow: { c: "var(--yellow)", lab: "Dimensionamento" }, green: { c: "var(--green)", lab: "Segnale" } };
/* editor soglie (v143): select + valore + spiegazione. Gli override mutano RISK_PARAMS e
   rilanciano renderAll: verdetto, chips e export AI riflettono subito la nuova soglia. */
function rpShownValue(d) { return d ? Math.round(RISK_PARAMS[d.key] * d.scale * 100) / 100 : ""; }

/* ⚠ v253 — renderRiskParams() e initRiskEditor() RIMOSSE. Scrivevano su #risk-params-grid
   e sui cinque campi dell'editor soglie: contenitori che non esistono più da quando il CEO
   ha chiesto di togliere la scheda "Parametri di Rischio del Fondo" (restano solo il
   Calcolatore PMC e il Calcolo vendite). Grazie a `?.` non davano errore: giravano a ogni
   render e scrivevano nel vuoto. Ricevuta scritta PRIMA del taglio: dentro i confini di
   entrambe non c'era NESSUNA altra dichiarazione di primo livello — è il controllo che in
   v238 guardava solo le `function` e lasciò passare un `let`, uccidendo la pagina.
   RISK_PARAMS, rpShownValue e openRiskRuleModal RESTANO: hanno altri consumatori. */

function openRiskRuleModal(r) {
  if (!r) return;
  const tier = RP_TIER[r.tier];
  const body = `
    <div class="rp-modal-head" style="border-left:4px solid ${tier.c}">
      <div class="rp-modal-tier" style="color:${tier.c}">${tier.lab}${r.active ? ' · <b>ATTIVA ORA</b>' : ""}</div>
      <div class="rp-modal-th">Soglia: <b>${esc(r.th)}</b></div>
    </div>
    <div class="rp-modal-state"><span class="muted">Stato corrente:</span> ${esc(r.state)}</div>
    <div class="rp-modal-why">${esc(r.why)}</div>
    <div class="info-line muted" style="font-size:11px;margin-top:10px">Vive in: ${esc(r.where)} · le soglie principali si modificano dal menu in cima a questa sezione (Parametri di Rischio → scegli parametro, inserisci valore, Salva).</div>`;
  openInfoModal(r.label, body);
}

/* v135: la barra "Decisione operativa" in cima è stata RIMOSSA (il verdetto vive nell'export
   AI). Il DIARIO delle azioni resta accessibile dal bottone "📔 Diario" della topbar, che
   apre lo stesso modal (dettaglio verdetto + editor del diario che finisce nel prompt). */
/* ============ VALIDATORE DEL RITORNO (v137) — chiude il loop analisi→ordine ============
   L'export va a Claude; la risposta torna QUI prima del broker: gli ordini proposti nel
   report vengono estratti dal testo e verificati contro gli STESSI invarianti del red team
   (ticker esistente, 0<stop<limite≤prezzo, banda 30% anti-SNDK, veto risk manager, cap 10%
   NAV, budget cassa−ES95). Un LLM che allucina un limite folle non arriva mai al broker. */

// numeri in formato italiano (1.325,03) O anglosassone (1,325.03) O semplice (626 / 626.5)
function parseMoneyLoose(s) {
  s = String(s || "").replace(/[$€\s]/g, "");
  if (!s) return null;
  const lastDot = s.lastIndexOf("."), lastCom = s.lastIndexOf(",");
  let v;
  if (lastDot >= 0 && lastCom >= 0) {                    // entrambi: l'ULTIMO separatore è il decimale
    const dec = Math.max(lastDot, lastCom);
    v = parseFloat(s.slice(0, dec).replace(/[.,]/g, "") + "." + s.slice(dec + 1));
  } else if (lastCom >= 0) {                             // solo virgola: 1-2 cifre dopo = decimale it
    v = (s.length - lastCom - 1) <= 2 ? parseFloat(s.slice(0, lastCom).replace(/,/g, "") + "." + s.slice(lastCom + 1))
                                      : parseFloat(s.replace(/,/g, ""));
  } else if (lastDot >= 0) {                             // solo punto: 3 cifre dopo = migliaia it ($1.325)
    v = ((s.length - lastDot - 1) === 3 && s.length > 4) ? parseFloat(s.replace(/\./g, "")) : parseFloat(s);
  } else v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

const AI_BUY = /\b(COMPRA|ACCUMULA|NUOVO\s+INGRESSO)\b/i;
const AI_SELL = /\b(VENDI|TRIM(?:MA)?|ALLEGGERISCI|RIDUCI)\b/i;

/* estrae gli ordini dal testo libero del report AI: righe con un ticker NOTO + verbo d'azione.
   Formato canonico della testata: "[TICKER] — COMPRA ~N quote a limite $X con stop $Y",
   ma il parser tollera variazioni (limite/a/ingresso; stop/stop loss). */
function parseAIOrders(text) {
  const known = new Map();
  for (const r of [...(DATA.portfolio || []), ...(DATA.watchlist || [])]) if (r.ticker) known.set(r.ticker.toUpperCase(), r);
  const orders = [];
  const seen = new Set();
  for (const rawLine of String(text || "").split("\n")) {
    // NORMALIZZAZIONE v149: gli LLM emettono ordini anche in TABELLE markdown ("| **RGTI** |
    // VENDI | ~595 | **$14,31** …") nonostante il formato canonico A2 — visto su Gemini 21/07.
    // Via grassetto e pipe→separatore, così ticker/verbo/importi tornano estraibili.
    const line = rawLine.replace(/\*\*/g, "").replace(/\s*\|\s*/g, " · ").trim();
    if (line.length < 8) continue;
    const isBuy = AI_BUY.test(line), isSell = AI_SELL.test(line);
    if (!isBuy && !isSell) continue;
    // ticker noto presente come parola (evita match dentro altre parole)
    let tk = null;
    for (const k of known.keys()) {
      if (new RegExp(`(^|[^A-Z0-9.\\-])${k.replace(/[-=^.]/g, "\\$&")}([^A-Z0-9.\\-]|$)`).test(line.toUpperCase())) { tk = k; break; }
    }
    if (!tk) {
      // riga in formato ordine canonico ("[XXX] — VERBO…") su ticker NON nel payload:
      // NON ignorarla in silenzio — è l'allucinazione che il validatore esiste per beccare
      const m = line.match(/^\[?([A-Z][A-Z0-9.\-=^]{0,9})\]?\s*—/);
      if (m && !known.has(m[1].toUpperCase())) {
        orders.push({ tk: m[1].toUpperCase(), action: isBuy ? "BUY" : "SELL", qty: null, limit: null, stop: null,
                      line: line.slice(0, 160), unknown: true });
      }
      continue;
    }
    const sig = tk + "|" + (isBuy ? "B" : "S");
    if (seen.has(sig)) continue;                        // primo ordine per ticker/verso (il resto è prosa)
    seen.add(sig);
    const num = "([\\d.,]+)";
    // fallback tabellare v149: "~595" nudo (colonna Quantità, senza "quote") e primo "$X" della
    // riga NON preceduto da parole di tracciabilità (Prezzo/Supp./Stop/res/PMC: sono citazioni,
    // non il limite). Niente lookbehind (Safari vecchi): scansione esplicita dei "$X" con la
    // parola precedente in blocklist. Il formato canonico resta prioritario.
    const qtyM = line.match(new RegExp(`~?\\s*(\\d+)\\s*(?:quote|azioni)`, "i"))
              || line.match(/~\s*(\d+)(?![\d.,%])/);
    let limM = line.match(new RegExp(`(?:limite|ingresso)\\s*(?:di|d'|a)?\\s*\\$?\\s*${num}`, "i"))
            || line.match(new RegExp(`\\ba\\s+\\$\\s*${num}`, "i"));
    if (!limM) {
      for (const m of line.matchAll(new RegExp(`(\\S*)\\s*\\$\\s*${num}`, "g"))) {
        if (!/^(prezzo|supp|stop|res|pmc)/i.test((m[1] || "").replace(/[^A-Za-z.]/g, ""))) { limM = [m[0], m[2]]; break; }
      }
    }
    const stopM = line.match(new RegExp(`stop(?:\\s*loss)?\\s*(?:\\(2×ATR\\))?\\s*(?:a|di)?\\s*\\$?\\s*${num}`, "i"));
    orders.push({ tk, action: isBuy ? "BUY" : "SELL", qty: qtyM ? parseInt(qtyM[1], 10) : null,
                  limit: limM ? parseMoneyLoose(limM[1]) : null, stop: stopM ? parseMoneyLoose(stopM[1]) : null,
                  line: line.slice(0, 160) });
  }
  return orders;
}

/* verifica gli ordini estratti contro gli invarianti del sistema. Ritorna righe con esito
   hard/warn/ok + verifica budget aggregata. STESSE classi di violazione del red team I1. */
function validateAIOrders(orders) {
  const t = DATA.totals || {};
  const eurusd = DATA.eurusd || 1.08;
  const rows = [];
  const byTk = new Map();
  for (const r of [...(DATA.portfolio || []), ...(DATA.watchlist || [])]) if (r.ticker) byTk.set(r.ticker.toUpperCase(), r);
  const usdNav = dgFin(t.usd_value);
  const budgetUsd = (dgFin(t.budget_operativo_spendibile) ?? 0) * eurusd;
  let buyNotional = 0;
  for (const o of orders) {
    const hard = [], warn = [];
    const r = byTk.get(o.tk);
    if (!r) { rows.push({ ...o, level: "hard", msgs: ["ticker non presente nel payload (allucinazione)"] }); continue; }
    const price = dgFin(r.price);
    if (o.action === "BUY") {
      const veto = typeof qualityVeto === "function" ? qualityVeto(r) : null;
      if (veto && !veto.rehab) hard.push(`titolo in VETO risk manager (${(veto.why || [veto.verdict]).join(", ")})`);
      else if (veto && veto.rehab) warn.push("riabilitato dal veto Sortino: SORVEGLIATO, sizing prudente");
      const vUsd = r.currency === "EUR" ? (dgFin(r.value) ?? 0) * eurusd : dgFin(r.value);
      const w = (vUsd && usdNav) ? vUsd / usdNav * 100 : null;
      if (r.qty && w != null && w >= (RISK_PARAMS?.capNoAdd_pct ?? 10)) hard.push(`cap d'ingresso: posizione già ${fmtNum.format(Math.round(w * 10) / 10)}% del NAV (divieto di accumulo)`);
      if (o.limit == null) warn.push("nessun prezzo LIMITE rilevato (gli ordini a mercato sono vietati dalla disciplina)");
      else {
        if (!(o.limit > 0)) hard.push("limite ≤ 0");
        if (price && o.limit > price * 1.02) hard.push(`limite $${fmtNum.format(o.limit)} SOPRA il prezzo corrente $${fmtNum.format(price)}`);
        if (price && (price - o.limit) / price > 0.30) hard.push(`limite $${fmtNum.format(o.limit)} oltre il 30% dal prezzo $${fmtNum.format(price)} (classe incidente SNDK)`);
      }
      if (o.stop == null) warn.push("nessuno stop rilevato: proteggi l'ingresso col 2×ATR");
      else {
        if (!(o.stop > 0)) hard.push("stop ≤ 0");
        if (o.limit != null && o.stop >= o.limit) hard.push(`stop $${fmtNum.format(o.stop)} ≥ limite $${fmtNum.format(o.limit)} (ordine long impossibile)`);
      }
      const in7 = r.earnings_date && (new Date(r.earnings_date) - Date.now()) / 86400000 <= 7 && (new Date(r.earnings_date) - Date.now()) >= 0;
      if (in7) warn.push(`earnings ${String(r.earnings_date).slice(5, 10)} entro 7g: ingresso post-evento o sizing dimezzato`);
      if (o.qty && o.limit) buyNotional += o.qty * o.limit;
    } else {
      if (!r.qty) hard.push("vendita di un titolo NON detenuto (è in watchlist)");
      else if (o.qty && o.qty > r.qty) hard.push(`quantità ${o.qty} > posseduta ${r.qty}`);
      if (o.limit != null && price && o.limit < price * 0.95) warn.push(`limite di vendita $${fmtNum.format(o.limit)} molto sotto il mercato $${fmtNum.format(price)} (svendita?)`);
    }
    rows.push({ ...o, level: hard.length ? "hard" : warn.length ? "warn" : "ok", msgs: [...hard, ...warn] });
  }
  const budget = { spend: Math.round(buyNotional), budget: Math.round(budgetUsd),
                   ok: !(budgetUsd > 0 && buyNotional > budgetUsd * 1.05) };
  return { rows, budget, hardCount: rows.filter(x => x.level === "hard").length + (budget.ok ? 0 : 1),
           warnCount: rows.filter(x => x.level === "warn").length };
}

function renderAIValidation(text) {
  const orders = parseAIOrders(text);
  if (!orders.length) return `<div class="muted" style="font-size:12px;margin-top:6px">Nessun ordine riconosciuto nel testo (cerco righe con un ticker del payload + COMPRA/ACCUMULA/VENDI/TRIM). Il formato canonico "[TICKER] — COMPRA ~N quote a limite $X con stop $Y" è il più affidabile.</div>`;
  const v = validateAIOrders(orders);
  const ico = { ok: "✅", warn: "⚠️", hard: "⛔" };
  const rows = v.rows.map(x => `<tr class="val-${x.level}">
    <td class="tk">${esc(x.tk)}</td><td>${x.action === "BUY" ? "Acquisto" : "Vendita"}</td>
    <td class="num">${x.qty ?? "—"}</td><td class="num">${x.limit != null ? "$" + fmtNum.format(x.limit) : "—"}</td>
    <td class="num">${x.stop != null ? "$" + fmtNum.format(x.stop) : "—"}</td>
    <td>${ico[x.level]} ${x.msgs.length ? esc(x.msgs.join(" · ")) : "invarianti rispettate"}</td></tr>`).join("");
  return `<table class="info-table" style="margin-top:8px"><thead><tr><th>Titolo</th><th>Azione</th><th class="num">Qtà</th><th class="num">Limite</th><th class="num">Stop</th><th>Esito</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="info-line ${v.budget.ok ? "" : "neg"}" style="font-size:12px;margin-top:6px">${v.budget.ok ? "✅" : "⛔"} Spesa d'acquisto ~$${fmtNum.format(v.budget.spend)} vs budget operativo $${fmtNum.format(v.budget.budget)} (cassa − ES95)${v.budget.ok ? "" : " — SFORATO"}</div>
    <div class="info-line" style="font-size:12.5px;margin-top:4px"><b>${v.hardCount ? `⛔ ${v.hardCount} violazioni HARD — NON eseguire questi ordini senza correggerli` : v.warnCount ? `⚠️ nessuna violazione hard, ${v.warnCount} avvisi` : "✅ tutti gli ordini rispettano gli invarianti del fondo"}</b></div>`;
}

function openDecisionModal() {
  // v141: il modal è SOLO Diario + Validatore (la "sintesi delle operazioni" del motore è stata
  // rimossa su direttiva CEO: il verdetto operativo vive nell'export AI, non in un popup).
  const diary = loadDiary();
  const diaryHtml = diary.length ? diary.map(e => `
    <div class="diary-item" data-iso="${e.date}">
      <span class="diary-date">${new Date(e.date).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" })}</span>
      <span class="diary-body">${diaryOpLine(e)}<span class="diary-text">${esc(e.text)}</span></span>
      <button class="diary-edit" data-iso="${e.date}" title="Modifica questa voce">✎</button>
      <button class="diary-del" data-iso="${e.date}" title="Elimina">✕</button>
    </div>`).join("") : `<div class="muted" style="font-size:12px">Nessuna voce ancora. Annota le operazioni con la loro FONTE: il diario viaggia nell'export AI e alimenta l'attribuzione.</div>`;
  openInfoModal("📔 Diario delle azioni",
    `<div class="info-line muted" style="font-size:11px;margin-bottom:6px">Qui vanno SOLO le operazioni che ESEGUI davvero (tue decisioni): il diario viaggia nell'export AI e dà continuità ai consigli.</div>
     <div class="diary-form">
       <select id="d-tipo" aria-label="Tipo operazione"><option value="ACQUISTO">Acquisto</option><option value="VENDITA">Vendita</option></select>
       <input id="d-qty" type="number" min="1" step="1" placeholder="Quantità" aria-label="Quantità">
       <input id="d-tk" type="text" placeholder="Ticker" aria-label="Ticker" list="d-tk-list" maxlength="12">
       <input id="d-px" type="number" step="0.01" placeholder="Prezzo" aria-label="Prezzo">
       <input id="d-when" type="date" aria-label="Data operazione">
       <input id="d-note" type="text" placeholder="Nota (facoltativa)" aria-label="Nota" maxlength="200">
       <button class="btn btn-primary btn-sm" id="diary-save">Registra</button>
     </div>
     <datalist id="d-tk-list">${[...new Set([...(DATA?.portfolio || []), ...(DATA?.watchlist || [])].map(r => r && r.ticker).filter(Boolean))].map(t => `<option value="${esc(t)}">`).join("")}</datalist>
     <div class="diary-list" id="diary-list">${diaryHtml}</div>`);
  const refresh = () => { closeChartModal(); openDecisionModal(); };
  // v142: il diario è SOLO delle operazioni ESEGUITE dal CEO (niente select fonte, niente
  // registrazione dei report LLM). v165: il Validatore è stato RIMOSSO dal popup su direttiva
  // CEO; le funzioni pure (parseAIOrders/validateAIOrders) restano, testate e riusabili.
  $("#diary-save")?.addEventListener("click", () => {
    // dal form STRUTTURATO: l'op è già nota, il testo si compone in forma canonica (e resta
    // leggibile nell'export AI, dove il diario viaggia come prosa).
    const tipo = $("#d-tipo")?.value || "ACQUISTO";
    const qty = parseInt($("#d-qty")?.value || "", 10);
    const tk = ($("#d-tk")?.value || "").trim().toUpperCase();
    const px = parseFloat(($("#d-px")?.value || "").replace(",", "."));
    const wRaw = $("#d-when")?.value || "";
    const nota = ($("#d-note")?.value || "").trim();
    if (!tk && !Number.isFinite(qty)) { toast("Indica almeno ticker e quantità"); return; }
    const quando = wRaw ? wRaw.split("-").reverse().join("/")
                        : new Date().toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
    const op = { tipo, qty: Number.isFinite(qty) ? qty : null, ticker: tk || null,
                 prezzo: Number.isFinite(px) ? px : null, quando, multi: false };
    const testo = [`${tipo === "ACQUISTO" ? "Acquisto" : "Vendita"}`,
                   Number.isFinite(qty) ? `${qty} quote` : null, tk || null,
                   Number.isFinite(px) ? `a ${px}` : null, `il ${quando}`,
                   nota ? `— ${nota}` : null].filter(Boolean).join(" ");
    saveDiaryEntry(testo, op);
    refresh();
  });
  document.querySelectorAll(".diary-del").forEach(b => b.addEventListener("click", () => { deleteDiaryEntry(b.dataset.iso); refresh(); }));
  document.querySelectorAll(".diary-edit").forEach(b => b.addEventListener("click", () => {
    const entry = loadDiary().find(x => x.date === b.dataset.iso);
    if (!entry) return;
    deleteDiaryEntry(b.dataset.iso);
    const inp = $("#diary-input");
    if (inp) { inp.value = entry.text; inp.dispatchEvent(new Event("input")); inp.focus(); }
    document.querySelector(`.diary-item[data-iso="${b.dataset.iso}"]`)?.remove();
    toast("Voce caricata nel campo: modifica e premi Aggiungi");
  }));
}

/* mini-trend di una metrica vs ~1 settimana fa (dallo storico metrics_history della pipeline) */
function metricTrend(field) {
  const h = DATA.metrics_history || [];
  if (h.length < 2) return "";
  const cur = h[h.length - 1]?.[field];
  const past = h[Math.max(0, h.length - 8)]?.[field];   // ~7 punti (giorni) fa
  if (cur == null || past == null) return "";
  const d = cur - past;
  const eps = field === "sharpe" ? 0.05 : 0.3;
  const dTxt = field === "sharpe" ? (d > 0 ? "+" : "") + fmtNum.format(Math.round(d * 100) / 100)
    : (d > 0 ? "+" : "") + fmtNum.format(Math.round(d * 10) / 10) + " pp";
  if (Math.abs(d) < eps) return `<span class="trend trend-flat" title="stabile vs ~1 settimana fa">→</span>`;
  return d > 0
    ? `<span class="trend trend-up" title="${dTxt} vs ~1 settimana fa">▲</span>`
    : `<span class="trend trend-down" title="${dTxt} vs ~1 settimana fa">▼</span>`;
}

/* Stato Margin Debt condiviso 1:1 tra card, popup e prompt AI (niente stringhe divergenti).
   Logica AND: rosso "ESTREMA" SOLO se leva ≥90% del picco E Forward P/E >20 conferma;
   ≥90% senza conferma → giallo (con nota esplicita se il P/E manca). */
/* ═══ v250 — OGNI DATO MACRO DICE QUANDO È STATO RILEVATO E QUANDO ARRIVA IL PROSSIMO ══════
   Richiesta CEO: "nelle card macro fornisci data aggiornamento dato e prossimo aggiornamento".
   È la risposta strutturale al dubbio sul margin debt: il problema non era che il dato fosse
   sbagliato, era che NON SI SAPEVA di che mese fosse né quando ne sarebbe arrivato uno nuovo.
   Un dato di 68 giorni con scritto "il prossimo esce il 20 agosto" è informazione; lo stesso
   dato senza quella riga è una trappola.
   ⚠ Le cadenze qui sotto sono il CALENDARIO DICHIARATO DALLE FONTI, non una stima mia:
   ogni voce porta scritto da dove viene la regola. Dove la data esatta non è deducibile si
   dichiara la cadenza e basta, invece di inventare un giorno. */
const CADENZA_FONTE = {
  margin_debt: { nome: "FINRA", giorniLag: 20, passo: "mensile",
                 nota: "FINRA pubblica il mese M nella terza settimana di M+1" },
  cpi:    { nome: "BLS", giorniLag: 13, passo: "mensile", nota: "CPI del mese M esce a metà M+1" },
  pce:    { nome: "BEA", giorniLag: 30, passo: "mensile", nota: "PCE del mese M esce a fine M+1" },
  nfp:    { nome: "BLS", giorniLag: 5,  passo: "mensile", nota: "primo venerdì del mese successivo" },
  unemp:  { nome: "BLS", giorniLag: 5,  passo: "mensile", nota: "esce col dato sugli occupati" },
  retail: { nome: "Census", giorniLag: 15, passo: "mensile", nota: "vendite del mese M a metà M+1" },
  umich:  { nome: "UMich via FRED", giorniLag: 45, passo: "mensile",
            nota: "FRED sconta 1-2 mesi di ritardo di LICENZA: alla fonte esistono letture più recenti" },
  gdp:    { nome: "BEA", giorniLag: 30, passo: "trimestrale", nota: "stima avanzata ~1 mese dopo il trimestre" },
};

/* Restituisce { rilevato, eta, prossimo, passo, fonte, nota } o null se non si può dire nulla.
   ⚠ `prossimo` è una DATA ATTESA, non una certezza: si scrive sempre col "atteso". */
function cadenzaDato(chiave, dataRilevazione) {
  const c = CADENZA_FONTE[chiave];
  if (!c || !dataRilevazione) return null;
  const d = new Date(String(dataRilevazione).slice(0, 10) + "T00:00:00");
  if (isNaN(d)) return null;
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const eta = Math.round((oggi - d) / 86400000);
  /* il prossimo dato copre il periodo SUCCESSIVO a quello rilevato, e arriva `giorniLag`
     dopo la fine di quel periodo: si somma un passo alla rilevazione e poi il ritardo. */
  const p = new Date(d);
  if (c.passo === "trimestrale") p.setMonth(p.getMonth() + 6);
  else p.setMonth(p.getMonth() + 2);
  p.setDate(Math.min(c.giorniLag || 15, 28));
  return {
    rilevato: String(dataRilevazione).slice(0, 10), eta,
    prossimo: p.toISOString().slice(0, 10),
    scaduto: p < oggi,                       // il prossimo era atteso e non è arrivato
    passo: c.passo, fonte: c.nome, nota: c.nota,
  };
}

/* la riga da mostrare sotto una card macro e da mettere nel payload */
function rigaCadenza(chiave, dataRilevazione) {
  const c = cadenzaDato(chiave, dataRilevazione);
  if (!c) return "";
  const it = (s) => { const [a, m, g] = [s.slice(0, 4), s.slice(5, 7), s.slice(8, 10)]; return `${g}/${m}/${a}`; };
  return `rilevazione ${it(c.rilevato)} (${c.eta} giorni fa) · prossimo atteso ${it(c.prossimo)}` +
         (c.scaduto ? " ⚠ ERA ATTESO E NON È ARRIVATO" : "") + ` · ${c.fonte}, ${c.passo}`;
}

/* ═══ v253 — LE CARD DI MERCATO NON DICEVANO QUANDO SONO STATE RILEVATE ═══════════════
   Misurato sulla pagina viva: 6 card su 27 portavano la riga di cadenza, 21 no. Non è che
   mancasse il dato — VIX, Fear & Greed, EUR/USD, put/call, DXY, curva, spread di credito e
   compagnia non hanno un calendario di pubblicazione: si aggiornano a OGNI run della
   pipeline. Ma "si aggiorna spesso" non è ciò che il CEO ha chiesto: ha chiesto di sapere
   di quando è il numero che sta guardando, e su quelle 21 card la risposta non c'era.
   Gli orari qui sotto sono il calendario DICHIARATO in .github/workflows/update-data.yml,
   non una stima — e un check li rilegge da quel file, perché un registro copiato a mano
   invecchia da solo (è la classe C10 e degli indici fissi del red team). */
const RUN_FISSI_UTC = [[4, 0], [5, 0], [8, 0], [9, 0], [13, 30], [14, 30], [15, 0], [16, 0], [19, 0], [20, 0], [21, 0]];
const RUN_ORARIO_UTC = { da: 13, a: 22, feriali: true };   // cron "0 13-22 * * 1-5"

/* prossimo run atteso della pipeline, in UTC. Considera sia i run fissi sia quello orario
   dei giorni feriali; guarda fino a 48 ore avanti e poi si arrende invece di indovinare. */
function prossimoRunPipeline(adesso = new Date()) {
  /* ⚠ la prima stesura avanzava a passi di 10 minuti da ADESSO: il minuto restava congruo a
     quello di partenza, quindi alle 18:53 la sequenza era 19:03, 19:13… e il run delle 19:00
     non veniva MAI incontrato. Si costruiscono invece i candidati del giorno, che è ciò che
     il cron fa davvero. */
  for (let g = 0; g <= 2; g++) {
    const base = new Date(adesso.getTime() + g * 86400000);
    const gi = base.getUTCDay(), feriale = gi >= 1 && gi <= 5;
    const cand = RUN_FISSI_UTC.map(([H, M]) => [H, M]);
    if (RUN_ORARIO_UTC.feriali && feriale) {
      for (let h = RUN_ORARIO_UTC.da; h <= RUN_ORARIO_UTC.a; h++) cand.push([h, 0]);
    }
    const oggi = cand
      .map(([H, M]) => Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), H, M))
      .filter((ms) => ms > adesso.getTime())
      .sort((a, b) => a - b);
    if (oggi.length) return new Date(oggi[0]);
  }
  return null;
}

/* la riga di freschezza per un dato che si aggiorna a ogni run (non ha un calendario di
   pubblicazione). Si basa su DATA.updated_at, che è il timestamp REALE del run che ha
   prodotto questo file — non sull'orologio del browser. */
function rigaFreschezzaMercato() {
  const iso = DATA && DATA.updated_at;
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const oreFa = Math.max(0, Math.round((Date.now() - d.getTime()) / 3600000));
  const hhmm = (x) => x.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  const p = prossimoRunPipeline();
  return `rilevazione al run delle ${hhmm(d)} del ${d.toLocaleDateString("it-IT").slice(0, 5)}`
       + ` (${oreFa === 0 ? "meno di un'ora fa" : oreFa === 1 ? "1 ora fa" : `${oreFa} ore fa`})`
       + (p ? ` · prossimo run atteso alle ${hhmm(p)}` : "")
       + " · dato di mercato, si aggiorna a ogni run";
}

function marginDebtState() {
  /* METODOLOGIA v106 (post-audit): il "% del picco" è SATURO in un bull market — verificato
     13/13 mesi a >=95% del picco: allarme permanente = potere discriminante zero. La label è
     ora guidata dal TASSO DI ESPANSIONE (YoY) della leva, che è il segnale storicamente
     predittivo (~+60% nel 2000, ~+40% nel 2007), con l'INVERSIONE dai massimi (YoY o MoM
     negativi dopo un picco) come stato peggiore: il deleveraging È il crash che inizia.
     Livello assoluto e ATH restano nel payload come contesto. */
  const m = DATA?.macro || {};
  const md = m.margin_debt;
  if (!md || md.pct_of_peak == null) return null;
  const fpe = m.forward_pe?.value ?? null;
  const yoy = md.yoy, mom = md.qoq;
  const nearPeak = md.pct_of_peak >= 90;
  const rollover = nearPeak && ((mom != null && mom < -2) || (yoy != null && yoy < 0));
  const high = yoy != null ? yoy >= 20 : nearPeak;             // fallback al livello se YoY n.d.
  const extreme = yoy != null && yoy >= 40;
  const confirmed = (extreme || high) && fpe != null && fpe > 20;
  let label, labelShort, col, score;
  if (rollover)      { label = "INVERSIONE DELLA LEVA dai massimi (deleveraging in corso)"; labelShort = "DELEVERAGING"; col = "var(--red)"; score = 2; }
  else if (extreme)  { label = confirmed ? `Espansione leva ESTREMA (YoY ${fmtNum.format(yoy)}%, confermata da Forward P/E)` : `Espansione leva ESTREMA (YoY ${fmtNum.format(yoy)}%)${fpe == null ? " — conferma P/E n.d." : ""}`; labelShort = "Espansione ESTREMA"; col = "var(--red)"; score = 8; }
  else if (high)     { label = `Espansione leva ELEVATA${yoy != null ? ` (YoY ${fmtNum.format(yoy)}%)` : ""}${fpe == null ? " — conferma P/E n.d." : ""}`; labelShort = "Espansione ELEVATA"; col = "var(--yellow)"; score = 25; }
  else if (yoy != null && yoy >= 0) { label = `Leva in espansione fisiologica (YoY ${fmtNum.format(yoy)}%)`; labelShort = "Espansione fisiologica"; col = "var(--yellow)"; score = 55; }
  else               { label = yoy != null ? `Leva in contrazione (YoY ${fmtNum.format(yoy)}%)` : "Leva BASSA"; labelShort = "In contrazione"; col = "var(--green)"; score = 75; }
  return { md, fpe, high: extreme || high, confirmed, rollover, label, labelShort, col, score };
}

function renderMiniCards() {
  const m = DATA.macro || {};
  const dir = marketDirectionScore();
  const dBox = $("#market-direction");
  if (dBox && dir != null) {
    const lab = dir >= 60 ? "Rialzista" : dir <= 40 ? "Ribassista" : "Laterale";
    dBox.innerHTML = `<div class="mc-title">Direzione mercato</div>
      ${compactSemiGauge(dir, ["Ribasso", "Rialzo"])}
      <div class="mc-value" style="color:${scoreColor(dir)}">${dir}% · ${lab}</div>
      <div class="mc-sub muted">media di tutti i segnali tecnici e macro</div>`;
  }
  const sp = m.signposts, sBox = $("#signposts-box");
  if (sBox && sp) {
    const risk = sp.pct >= 70 ? "Rischio alto" : sp.pct >= 40 ? "Rischio medio" : "Rischio basso";
    sBox.innerHTML = `<div class="mc-title">BofA Bear-Market Signposts</div>
      ${compactSemiGauge(100 - sp.pct, ["Solido", "Ribassista"])}
      <div class="mc-value" style="color:${scoreColor(100 - sp.pct)}">${sp.active}/${sp.total} attivi · ${risk}</div>
      <div class="mc-sub muted">clicca per il dettaglio dei 10 segnali</div>`;
  }
  // Rotazione settoriale (Tilt): settore leader (overweight) e fanalino
  const tilt = m.tilt, tBox = $("#tilt-box");
  if (tBox && tilt && tilt.length) {
    const sorted = [...tilt].sort((a, b) => b.m1 - a.m1);
    const defensives = ["Utilities", "Consumi difens.", "Salute", "Oro"];
    const defAvg = avg(tilt.filter(s => defensives.includes(s.name)).map(s => s.m1));
    const tech = tilt.find(s => s.ticker === "XLK");
    const isDef = (defAvg != null && tech) ? defAvg > tech.m1 : null;
    const regime = isDef == null ? "—" : isDef ? "Difensiva" : "Pro-rischio";
    const regimeCol = isDef == null ? "var(--muted)" : isDef ? "var(--yellow)" : "var(--green)";
    // score termometro: pro-rischio (tech>difensivi) = favorevole (alto)
    const score = (defAvg != null && tech) ? clamp(50 + (tech.m1 - defAvg) * 8) : 50;
    const lead = sorted[0], lag = sorted[sorted.length - 1];
    tBox.innerHTML = `<div class="mc-title">Rotazione settoriale</div>
      <div class="mc-value" style="color:${regimeCol}">${regime}</div>
      ${thermoLine(score, ["Pro-rischio", "Difensivo"])}
      <div class="mc-sub muted">↑ ${esc(lead.name.split(" ")[0])} ${signTxt(lead.m1)} · ↓ ${esc(lag.name.split(" ")[0])} ${signTxt(lag.m1)}</div>`;
  }
  // Quadruple Witching (4 streghe): ora mostrata nel popup del box Put/Call (vedi openMacroInfo "putcall")
  // MacroQuant (stile BCA)
  const mq = m.macroquant, mqBox = $("#macroquant-box");
  if (mqBox && mq) {
    const mqLab = mq.score >= 60 ? "Ciclo espansivo" : mq.score >= 40 ? "Ciclo neutro" : "Rischio recessione";
    mqBox.innerHTML = `<div class="mc-title">MacroQuant (Ciclo)</div>
      ${compactSemiGauge(mq.score, ["Crescita", "Recessione"])}
      <div class="mc-value" style="color:${scoreColor(mq.score)}">${mq.score}% · ${mqLab}</div>
      <div class="mc-sub muted">salute ciclo: PIL · lavoro · inflazione · credito</div>`;
  }
  // Stagionalità (S&P 500 / Nasdaq): tachimetro del mese corrente
  const se = m.seasonality, seBox = $("#seasonality-box");
  if (seBox && se && se.score != null) {
    const cm = MONTH_NAMES[(se.current_month || 1) - 1];
    const both = se.sp_score != null && se.ndx_score != null;
    const sub = both
      ? `${cm}: S&P ${se.sp_score}% · NDX ${se.ndx_score}%`
      : `${cm} · ${se.sp_score != null ? "S&P" : "Nasdaq"}`;
    seBox.innerHTML = `<div class="mc-title">Stagionalità (${cm})</div>
      ${compactSemiGauge(se.score, ["Favorevole", "Sfavorevole"])}
      <div class="mc-value" style="color:${scoreColor(se.score)}">${se.score}% · ${se.label}</div>
      <div class="mc-sub muted">${sub}</div>`;
  }
  /* v207 — INTERNI DI MERCATO. momentum, breadth, froth e futures esistono in data.json,
     finiscono nel payload per l'LLM, e in dashboard NON ERANO MAI MOSTRATI: il CEO leggeva
     nel report dell'AI conclusioni che poggiavano su numeri che la sua pagina non conteneva. */
  const iBox = $("#internals-box");
  if (iBox) {
    const righe = [];
    if (m.breadth?.divergence_pp != null) {
      const d = m.breadth.divergence_pp;
      righe.push([`Ampiezza (SPY vs RSP 1M)`, `${signTxt(d, " pp")}`,
        d <= -4 ? "neg" : d < 0 ? "warn" : "pos",
        d <= -4 ? "pochi titoli tirano l'indice" : "partecipazione allineata"]);
    }
    if (m.momentum?.sp500 != null) {
      const q = m.momentum.sp500;
      righe.push(["S&P vs media 125 sedute", signTxt(q.dist_pct), q.dist_pct >= 0 ? "pos" : "neg",
        q.dist_pct >= 0 ? "sopra la media di lungo periodo" : "sotto la media di lungo periodo"]);
    }
    if (m.froth) {
      const att = m.froth.alert === true;
      const rv = Math.max(m.froth.soxl?.rvol ?? 0, m.froth.tqqq?.rvol ?? 0);
      righe.push(["Schiuma su ETF a leva", att ? "ATTIVA" : "no", att ? "neg" : "pos",
        att ? "volumi anomali su SOXL/TQQQ dentro un rialzo" : `volumi normali (RVol max ${fmtNum.format(rv)}×)`]);
    }
    const fut = m.futures?.nasdaq;
    if (fut?.change_pct != null) {
      righe.push([esc(fut.label || "Futures Nasdaq"), signTxt(fut.change_pct),
        fut.change_pct >= 0 ? "pos" : "neg", `${fmtNum.format(fut.price)} — si muovono a mercato chiuso`]);
    }
    iBox.innerHTML = righe.length
      ? `<div class="mc-title">Interni di mercato</div>
         <div class="int-rows">${righe.map(([lab, val, cls, sub]) => `<div class="int-row">
           <span class="int-lab">${esc(lab)}</span><span class="int-val ${cls}">${esc(String(val))}</span>
           <span class="int-sub">${esc(sub)}</span></div>`).join("")}</div>`
      : `<div class="mc-title">Interni di mercato</div><div class="mc-sub muted">Non disponibili in questo snapshot.</div>`;
  }

  // Daily Tracking Error vs benchmark (oggi): portafoglio Day% − indice, come tachimetro
  const bm = m.benchmarks, teBox = $("#tracking-error-box");
  if (teBox && bm) {
    const pday = portfolioDayPct();
    const ref = bm.sp500 != null ? "sp500" : bm.ndx != null ? "ndx" : "sox";
    const refLab = { sp500: "S&P 500", ndx: "Nasdaq 100", sox: "SOX" }[ref];
    const alpha = (pday != null && bm[ref] != null) ? pday - bm[ref] : null;
    if (alpha != null) {
      const score = clamp(50 + alpha * 12);   // sovraperformance → verde
      const lab = alpha >= 0.3 ? "Sovraperforma" : alpha <= -0.3 ? "Sottoperforma" : "In linea";
      teBox.innerHTML = `<div class="mc-title">Tracking Error vs ${refLab}</div>
        ${compactSemiGauge(score, ["Sottoperf.", "Sovraperf."])}
        <div class="mc-value" style="color:${scoreColor(score)}">${signTxt(Math.round(alpha * 100) / 100)} pp · ${lab}</div>
        <div class="mc-sub muted">portaf. oggi ${pday != null ? signTxt(Math.round(pday * 100) / 100) : "—"} · clicca per dettaglio</div>`;
    } else {
      teBox.innerHTML = `<div class="mc-title">Tracking Error vs ${refLab}</div>
        ${compactSemiGauge(50, ["Sottoperf.", "Sovraperf."])}
        <div class="mc-value muted">—</div><div class="mc-sub muted">dati intraday non disponibili</div>`;
    }
  }
  // Sharpe Ratio del portafoglio (rendimento corretto per il rischio)
  const shBox = $("#sharpe-box");
  if (shBox) {
    const ps = (DATA.totals || {}).portfolio_sharpe_ratio;
    if (ps != null) {
      const score = clamp(33 + ps * 22);   // ~0=33, 1=55, 2=77, 3=99
      const lab = ps > 2 ? "Eccellente" : ps >= 1 ? "Buono" : ps >= 0 ? "Debole" : "Negativo";
      const so = (DATA.totals || {}).portfolio_sortino_ratio;
      // VaR: preferisci la stima STORICA (percentili empirici — onesta sulle code grasse)
      const varE = (DATA.totals || {}).var95_hist_eur ?? (DATA.totals || {}).var95_1d_eur;
      const subBits = [];
      if (so != null) subBits.push(`Sortino ${fmtNum.format(so)}`);
      if (varE != null) subBits.push(`VaR95 1g ${fmtEUR.format(varE)}`);
      // v209 — al posto del termometro, la SERIE: lo Sharpe ha 36 rilevazioni in
      // metrics_history e non erano mai state disegnate. Un termometro dice "dove sei",
      // una linea dice "da dove vieni", che su una metrica di regime è l'informazione.
      const serie = (DATA.metrics_history || [])
        .filter(x => x?.date && typeof x.sharpe === "number")
        .map(x => ({ d: x.date, v: x.sharpe }));
      const graf = serie.length >= 2
        ? graficoSerie([{ nome: "sharpe", punti: serie, colore: sharpeColor(ps) }],
            { h: 92, compatto: true, etichetteDx: false, tacche: 3,
              soglie: [{ v: 2, testo: "target 2,0", colore: "var(--muted)" }],
              assex: [`${serie.length} rilevaz.`, "oggi"], aria: "Sharpe del portafoglio nel tempo" })
        : thermoLine(score, ["Efficiente", "Rischioso"]);
      shBox.innerHTML = `<div class="mc-title">Sharpe Ratio portafoglio</div>
        <div class="mc-value" style="color:${sharpeColor(ps)}">${fmtNum.format(ps)} · ${lab} ${metricTrend("sharpe")}</div>
        ${graf}
        <div class="mc-sub muted">${subBits.length ? subBits.join(" · ") : "rendimento corretto per il rischio"}</div>`;
    } else {
      shBox.innerHTML = `<div class="mc-title">Sharpe Ratio portafoglio</div>
        <div class="mc-value muted">—</div>
        ${thermoLine(50, ["Efficiente", "Rischioso"])}
        <div class="mc-sub muted">disponibile dopo la pipeline</div>`;
    }
  }
  // Margin Debt: stato condiviso 1:1 con popup e prompt (marginDebtState)
  const mdBox = $("#margin-debt-box");
  if (mdBox) {
    const mds = marginDebtState();
    if (mds) {
      const md = mds.md;
      // label qualitativa nella card (il "100% del picco" nudo era inutilmente ansiogeno):
      // i numeri esatti restano nel popup di dettaglio. Solo rendering, zero impatti sui calcoli.
      const pctLab = md.pct_of_peak >= 95 ? "Sui massimi storici"
        : md.pct_of_peak >= 80 ? "Vicino ai massimi"
        : md.pct_of_peak >= 60 ? "Zona intermedia" : "Lontano dai massimi";
      mdBox.innerHTML = `<div class="mc-title">Margin Debt (leva mercato)</div>
        <div class="mc-value" style="color:${mds.col}">${pctLab} · ${mds.labelShort}</div>
        ${thermoLine(mds.score, ["Bassa", "Estrema"])}
        <div class="mc-sub muted">${md.yoy != null ? `YoY ${signTxt(md.yoy)}` : ""} · ${md.series || "FINRA/FRED"} · ${md.date || ""}</div>`;
    } else {
      mdBox.innerHTML = `<div class="mc-title">Margin Debt (leva mercato)</div>
        <div class="mc-value muted">—</div>${thermoLine(50, ["Bassa", "Estrema"])}
        <div class="mc-sub muted">disponibile dopo la pipeline</div>`;
    }
  }
  // Rischio Cambio EUR/USD: quota del NAV in USD non coperta
  const fxBox = $("#fx-box");
  if (fxBox) {
    const fx = fxExposure();
    if (fx) {
      // esposizione valutaria: oltre ~70% del NAV in USD = rischio cambio strutturale
      const score = clamp(100 - fx.pct);
      const lab = fx.pct >= 70 ? "Strutturale" : fx.pct >= 40 ? "Rilevante" : "Contenuto";
      fxBox.innerHTML = `<div class="mc-title">Rischio Cambio EUR/USD</div>
        <div class="mc-value" style="color:${scoreColor(score)}">${fmtNum.format(fx.pct)}% NAV in USD</div>
        ${thermoLine(score, ["Coperto", "Esposto"])}
        <div class="mc-sub muted">non coperto · ${lab}${fx.eurusd ? ` · EUR/USD ${fmtNum.format(fx.eurusd)}` : ""}</div>`;
    } else {
      fxBox.innerHTML = `<div class="mc-title">Rischio Cambio EUR/USD</div>
        <div class="mc-value muted">—</div>${thermoLine(50, ["Coperto", "Esposto"])}
        <div class="mc-sub muted">in attesa dei dati</div>`;
    }
  }
}

/* Popup Rischio Cambio: esposizione USD, sensibilità e razionale */
function openFxModal() {
  const fx = fxExposure();
  if (!fx) { toast("Dati non ancora disponibili"); return; }
  const hit1 = Math.round(fx.usdEur * 0.01);   // impatto di ±1% del cambio sul NAV in €
  openInfoModal("Rischio cambio EUR/USD — esposizione non coperta",
    `<div class="info-line" style="margin-bottom:8px"><b>Cos'è:</b> la quota del patrimonio denominata in dollari senza copertura valutaria. A parità di prezzi dei titoli, un <b>apprezzamento dell'euro</b> riduce il controvalore in € delle posizioni USA (e viceversa).</div>
     <div class="info-line" style="background:var(--card-2);border-radius:8px;padding:10px;margin-bottom:10px">
       <div style="font-size:13px">Esposizione USD: <b>${fmtNum.format(fx.pct)}% del NAV</b> (${fmtEUR.format(Math.round(fx.usdEur))} su ${fmtEUR.format(Math.round(fx.nav))})</div>
       <div class="muted" style="font-size:12px;margin-top:3px">${fx.eurusd ? `EUR/USD attuale ${fmtNum.format(fx.eurusd)} · ` : ""}sensibilità: ±1% del cambio ≈ <b>${fmtEUR.format(hit1)}</b> sul patrimonio</div>
     </div>
     <div class="info-line muted" style="font-size:11.5px">Il BTP e la liquidità in € non sono esposti. La copertura (hedging) ha un costo pari al differenziale tassi USD-EUR: per un portafoglio growth di lungo periodo molti fondi accettano l'esposizione, ma va dichiarata e monitorata — è un fattore di rischio a sé, separato dal rischio azionario.</div>`);
}

/* Popup Margin Debt: dato attuale, variazioni, sparkline storica, impatto */
function openMarginDebtModal() {
  const mds = marginDebtState();
  if (!mds) { toast("Dati Margin Debt non ancora disponibili"); return; }
  const md = mds.md;
  const bn = (v) => "$" + fmtNum.format(Math.round(v / 1000)) + " mld";
  // stessa identica logica della card e del prompt (marginDebtState)
  const risk = { t: mds.label.replace(/^Leva /, "").toUpperCase(), c: mds.col };
  openInfoModal("Margin Debt — leva a credito sul mercato",
    `<div class="info-line" style="margin-bottom:8px"><b>Cos'è:</b> il debito che gli investitori contraggono presso i broker per comprare titoli a leva. Quando è vicino ai massimi storici indica euforia e fragilità: nelle discese forza vendite a catena (margin call), amplificando i crolli.</div>
     <div class="info-line" style="background:var(--card-2);border-radius:8px;padding:10px;margin-bottom:10px">
       <div style="font-size:13px">Attuale: <b>${bn(md.value)}</b> · <b style="color:${risk.c}">${md.pct_of_peak}% del picco storico</b> · leva <b style="color:${risk.c}">${risk.t}</b></div>
       <div class="muted" style="font-size:12px;margin-top:3px">${md.yoy != null ? `YoY ${signTxt(md.yoy)}` : ""}${md.qoq != null ? ` · ultimo mese ${signTxt(md.qoq)}` : ""} · picco storico ${bn(md.peak)} · agg. ${md.date}</div>
     </div>
     <h4 style="margin:8px 0 4px">Storico (ultimi trimestri)</h4>
     <div class="psp-spark">${sparkline(md.history || [])}</div>
     ${systemicRiskHtml(md)}
     <div class="info-line muted" style="font-size:11.5px;margin-top:8px"><b>Impatto:</b> leva ${risk.t.toLowerCase()} → ${md.pct_of_peak >= 80 ? "mercato fragile: una correzione può innescare vendite forzate a catena. Per il tuo portafoglio tech (alta beta) significa drawdown potenzialmente più violenti — tieni pronta la liquidità e non aumentare la leva." : "rischio sistemico da leva contenuto: le discese hanno meno benzina da margin call. Contesto più sereno per accumulare con gradualità."}</div>`);
}

/* Rischio sistemico combinato: Margin Debt (leva) + Forward P/E (valutazione).
   ROSSO se leva vicino ai massimi E P/E forward elevato. Stima impatto deleveraging. */
function systemicRiskHtml(md) {
  const fpe = (DATA.macro || {}).forward_pe;
  const pe = fpe ? fpe.value : null;
  const peAvg = fpe ? fpe.avg_hist : 16.5;
  const highLev = md.pct_of_peak >= 90;
  const highPe = pe != null && pe > 20;
  const danger = highLev && highPe;
  const col = danger ? "#ef4444" : (highLev || highPe) ? "var(--yellow)" : "#38bdf8";
  const verdict = danger ? "RISCHIO SISTEMICO ELEVATO" : (highLev || highPe) ? "Rischio moderato" : "Rischio contenuto";
  // stima margin call su deleveraging -15%: storicamente ~10-15% del margin debt viene chiamato
  const callsBn = Math.round(md.value / 1000 * 0.12);   // ~12% del margin debt (in $ mld)
  return `<div class="info-line" style="background:var(--card-2);border-left:3px solid ${col};border-radius:8px;padding:10px;margin-top:10px">
    <div style="font-size:13px;font-weight:700;color:${col};margin-bottom:4px">${verdict}</div>
    <div style="font-size:12px">Leva (Margin Debt): <b>${md.pct_of_peak}% del picco</b> ${highLev ? "⚠" : ""}${md.series ? ` <span class="muted">(${esc(md.series)}, rilevazione ${md.date})</span>` : ""} · Valutazione (Forward P/E S&P): <b>${pe != null ? pe + "×" : "n.d. — dato API assente, nessuna stima fittizia"}</b>${pe != null ? ` vs media storica ${peAvg}×` : ""} ${highPe ? "⚠" : ""}</div>
    <div class="muted" style="font-size:11px;margin-top:4px">Logica: rosso se leva ≥90% del picco <b>E</b> Forward P/E &gt;20×. Scenario "deleveraging" (−15% mercato): possibili ~<b>$${fmtNum.format(callsBn)} mld</b> di margin call forzate, che amplificano la discesa. Tieni liquidità pronta per i ribassi.</div>
  </div>`;
}

/* Popup Sharpe di PORTAFOGLIO (diverso dal popup per-titolo openSharpeInfo) */
function openPortfolioSharpeModal() {
  const t = DATA.totals || {};
  const ps = t.portfolio_sharpe_ratio;
  const rf = (t.risk_free_rate ?? 0.0363) * 100;
  // contributo per titolo (Sharpe singolo, ordinato)
  const items = (DATA.portfolio || []).filter(r => r.sharpe_1y != null)
    .sort((a, b) => b.sharpe_1y - a.sharpe_1y);
  const rows = items.map(r => `<tr><td>${esc(r.name)} <span class="tk">${r.ticker}</span></td><td class="num"><b style="color:${sharpeColor(r.sharpe_1y)}">${fmtNum.format(r.sharpe_1y)}</b></td></tr>`).join("");
  const verdict = ps == null ? null
    : ps > 2 ? { t: "ECCELLENTE", c: "var(--green)" }
    : ps >= 1 ? { t: "BUONO", c: "#86c52a" }
    : ps >= 0 ? { t: "DEBOLE", c: "var(--muted)" }
    : { t: "NEGATIVO", c: "var(--red)" };
  const so = t.portfolio_sortino_ratio;
  const extraRisk = [];
  if (so != null) extraRisk.push(`<div style="font-size:12.5px;margin-top:6px"><b>Sortino</b>: <b style="color:${sharpeColor(so)}">${fmtNum.format(so)}</b> — come lo Sharpe ma conta solo la volatilità <b>negativa</b>: se è molto più alto dello Sharpe, gran parte della varianza è "buona" (rally), non rischio.</div>`);
  {
    // stima STORICA primaria (percentili empirici della serie reale: onesta sulle code
    // grasse dei titoli volatili); la parametrica normale resta come confronto
    const vE = t.var95_hist_eur ?? t.var95_1d_eur, vP = t.var95_hist_pct ?? t.var95_1d_pct;
    const eE = t.es95_hist_eur ?? t.es95_1d_eur;
    const isHist = t.var95_hist_eur != null;
    if (vE != null) extraRisk.push(`<div style="font-size:12.5px;margin-top:6px"><b>VaR 95% (1 giorno${isHist ? ", storico" : ", parametrico"})</b>: <b class="neg">${fmtEUR.format(vE)}</b> (${fmtNum.format(vP)}% dell'azionario) — la perdita che nel 95% dei giorni NON viene superata${isHist ? ", misurata sui percentili REALI degli ultimi 12 mesi" : ""}.${eE != null ? ` <b>Expected Shortfall</b>: <b class="neg">${fmtEUR.format(eE)}</b> — la perdita MEDIA nel 5% dei giorni peggiori (la coda oltre il VaR).` : ""}${isHist && t.var95_1d_eur != null ? ` <span class="muted">(col metodo parametrico normale: VaR ${fmtEUR.format(t.var95_1d_eur)}${t.es95_1d_eur != null ? `, ES ${fmtEUR.format(t.es95_1d_eur)}` : ""} — sottostima le code grasse)</span>` : ""}</div>`);
  }
  openInfoModal("Sharpe Ratio del portafoglio",
    `<div class="info-line" style="margin-bottom:10px"><b>Sharpe Ratio</b> = rendimento corretto per il rischio: l'extra-rendimento (sopra il tasso privo di rischio del <b>${fmtNum.format(rf)}%</b>) per ogni unità di volatilità. Quello di portafoglio è calcolato sulla <b>matrice di covarianza</b> pesata per controvalore, quindi tiene conto della diversificazione fra i titoli.</div>
     <div class="info-line" style="background:var(--card-2);border-radius:8px;padding:10px;margin-bottom:10px">
       <div style="font-size:13px">Portafoglio: <b style="color:${ps != null ? sharpeColor(ps) : 'var(--muted)'};font-size:20px">${ps != null ? fmtNum.format(ps) : "n.d."}</b> ${verdict ? `<span style="color:${verdict.c};font-weight:700">· ${verdict.t}</span>` : ""}</div>
       ${extraRisk.join("")}
     </div>
     <h4 style="margin:8px 0 4px">Scala</h4>
     <table class="info-table"><tbody>
       <tr><td><b style="color:var(--green)">&gt; 2,0</b></td><td>Eccellente</td></tr>
       <tr><td><b style="color:#86c52a">1,0 – 2,0</b></td><td>Buono (qualità istituzionale)</td></tr>
       <tr><td><b style="color:var(--muted)">0 – 1,0</b></td><td>Debole</td></tr>
       <tr><td><b style="color:var(--red)">&lt; 0</b></td><td>Rischio non ripagato</td></tr>
     </tbody></table>
     ${rows ? `<h4 style="margin:10px 0 4px">Sharpe per titolo</h4><table class="info-table"><thead><tr><th>Titolo</th><th class="num">Sharpe 1A</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="info-line muted" style="font-size:11.5px;margin-top:8px">Gli Sharpe per titolo compariranno dopo il prossimo run della pipeline.</div>`}`);
}

const MONTH_NAMES = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
const MONTH_ABBR = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];

/* Popup stagionalità: grafico a barre con rendimento medio mensile sovrapposto S&P + Nasdaq */
function openSeasonalityModal() {
  const se = (DATA.macro || {}).seasonality;
  if (!se) { toast("Dati stagionalità non disponibili"); return; }
  const sp = se.sp500 || [], ndx = se.ndx || [];
  const cm = se.current_month || 1;
  // range comune per scalare le barre
  const allAvg = [...sp, ...ndx].map(x => x.avg).filter(v => v != null);
  const maxAbs = Math.max(0.5, ...allAvg.map(Math.abs));
  const W = 620, H = 240, padL = 30, padB = 28, padT = 14, padR = 10;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const zeroY = padT + innerH / 2;
  const colW = innerW / 12;
  const barW = colW * 0.32;
  const bar = (arr, color, off) => arr.map(x => {
    if (x.avg == null) return "";
    const cx = padL + (x.m - 0.5) * colW + off;
    const h = Math.abs(x.avg) / maxAbs * (innerH / 2);
    const yTop = x.avg >= 0 ? zeroY - h : zeroY;
    const hl = x.m === cm ? `stroke="var(--text)" stroke-width="1"` : "";
    return `<rect x="${(cx - barW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" fill="${color}" ${hl}><title>${MONTH_NAMES[x.m - 1]}: ${x.avg > 0 ? "+" : ""}${x.avg}% medio · ${x.pos}% positivi (${x.n} anni)</title></rect>`;
  }).join("");
  const monthLabels = MONTH_ABBR.map((mn, i) => {
    const cx = padL + (i + 0.5) * colW;
    const hl = (i + 1) === cm ? `font-weight="700" fill="var(--text)"` : `fill="var(--muted)"`;
    return `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" ${hl}>${mn}</text>`;
  }).join("");
  const gridY = [-maxAbs, 0, maxAbs].map(gv => {
    const gy = zeroY - gv / maxAbs * (innerH / 2);
    return `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" stroke="var(--border)" stroke-width="${gv === 0 ? 1.4 : 1}"/>
      <text x="${padL - 4}" y="${(gy + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="var(--muted)">${gv > 0 ? "+" : ""}${gv.toFixed(1)}%</text>`;
  }).join("");
  const spAvgY = sp.length ? (sp.reduce((s, x) => s + (x.avg || 0), 0) / sp.length) : 0;
  const ndxAvgY = ndx.length ? (ndx.reduce((s, x) => s + (x.avg || 0), 0) / ndx.length) : 0;
  const curSp = sp.find(x => x.m === cm), curNdx = ndx.find(x => x.m === cm);
  openInfoModal(`Stagionalità storica — ${MONTH_NAMES[cm - 1]}`,
    `<div class="info-line muted" style="font-size:11.5px;margin-bottom:8px">Rendimento medio mensile storico di <b style="color:var(--blue)">S&P 500</b> e <b style="color:var(--purple)">Nasdaq 100</b> per ogni mese del calendario (intera storia disponibile). Il mese corrente è evidenziato. Il tachimetro nella dashboard sintetizza la favorevolezza stagionale del mese in corso.</div>
     <div class="info-line" style="margin-bottom:6px">
       <b>Mese corrente (${MONTH_NAMES[cm - 1]}):</b>
       ${curSp ? ` S&P <span class="${signCls(curSp.avg)}">${curSp.avg > 0 ? "+" : ""}${curSp.avg}%</span> (${curSp.pos}% positivi)` : ""}
       ${curNdx ? ` · Nasdaq <span class="${signCls(curNdx.avg)}">${curNdx.avg > 0 ? "+" : ""}${curNdx.avg}%</span> (${curNdx.pos}% positivi)` : ""}
     </div>
     <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
       ${gridY}
       ${bar(sp, "var(--blue)", -barW * 0.6)}
       ${bar(ndx, "var(--purple)", barW * 0.6)}
       ${monthLabels}
     </svg>
     <div class="info-line" style="display:flex;gap:16px;font-size:11px;margin-top:6px">
       <span><span style="display:inline-block;width:10px;height:10px;background:var(--blue);border-radius:2px;vertical-align:middle"></span> S&P 500 (media ${spAvgY > 0 ? "+" : ""}${spAvgY.toFixed(2)}%/mese)</span>
       <span><span style="display:inline-block;width:10px;height:10px;background:var(--purple);border-radius:2px;vertical-align:middle"></span> Nasdaq 100 (media ${ndxAvgY > 0 ? "+" : ""}${ndxAvgY.toFixed(2)}%/mese)</span>
     </div>
     <div class="info-line muted" style="font-size:11px;margin-top:8px">La stagionalità è una tendenza statistica storica, NON una garanzia: usala come contesto di probabilità, non come segnale isolato. "Sell in May", il rally di fine anno (Santa Claus rally) e la debolezza di settembre sono i pattern più noti.</div>`);
}

/* ---------------- rotazione settoriale: heatmap + istogramma + popup ---------------- */
function perfColor(p) {
  // verde se sale, rosso se scende (gradiente proporzionale, ±10% = saturo)
  return scoreColor(clamp(50 + p * 5));
}

function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }

/* salute del portafoglio = media di TECNICA (titoli) + MACRO (direzione) + FONDAMENTALE (titoli) */
function portfolioHealthParts() {
  const m = DATA.macro || {};
  const parts = [];
  if (m.thermometer) parts.push(["Tecnica titoli", m.thermometer.score]);
  const dir = (typeof marketDirectionScore === "function") ? marketDirectionScore() : null;
  if (dir != null) parts.push(["Macro & mercato", dir]);
  const fin = (DATA.portfolio || []).map(r => r.fin_health).filter(v => v != null);
  if (fin.length) parts.push(["Fondamentale titoli", Math.round(avg(fin))]);
  return parts;
}
function portfolioHealthScore() {
  const p = portfolioHealthParts();
  return p.length ? Math.round(avg(p.map(x => x[1]))) : null;
}
function renderPortfolioHealth() {
  const box = $("#portfolio-health");
  if (!box) return;
  const score = portfolioHealthScore();
  if (score == null) { box.innerHTML = ""; return; }
  const lab = score >= 60 ? "Solido" : score <= 40 ? "Da monitorare" : "Equilibrato";
  box.innerHTML = `<div class="mc-title">Salute del portafoglio</div>
    <div class="mc-value" style="color:${scoreColor(score)}">${score}/100 · ${lab}</div>
    ${thermoLine(score, ["Solido", "Fragile"])}
    <div class="mc-sub muted">tecnica + macro + fondamentale</div>`;
}
function openHealthModal() {
  const score = portfolioHealthScore();
  if (score == null) return;
  const parts = portfolioHealthParts();
  openInfoModal("Salute del portafoglio",
    `<div class="info-line"><b>Punteggio complessivo:</b> <span style="color:${scoreColor(score)}">${score}/100</span> — media dei tre pilastri.</div>
     <table class="info-table"><tbody>${parts.map(p =>
      `<tr><td>${esc(p[0])}</td><td style="min-width:140px">${meterBar(p[1], scoreColor(p[1]), String(p[1]))}</td></tr>`).join("")}</tbody></table>
     <div class="info-line muted" style="margin-top:8px">Tecnica = RSI/trend/momentum medi dei titoli · Macro = direzione mercato aggregata · Fondamentale = Financial Health medio dei titoli. Verde = favorevole, rosso = rischio.</div>`);
}

// heatmap + istogramma + sintesi della rotazione (mostrati nel popup del widget Tilt)
function rotationDetailHtml() {
  const tilt = (DATA.macro || {}).tilt || [];
  if (!tilt.length) return "<div class='muted'>Dati rotazione non disponibili</div>";
  const sorted = [...tilt].sort((a, b) => b.m1 - a.m1);
  const maxAbs = Math.max(...sorted.map(s => Math.abs(s.m1)), 1);
  const hist = sorted.map(s => `<div class="rot-bar-row">
      <span class="rot-bar-lab">${esc(s.name)} <span class="tk">${s.ticker}</span></span>
      <span class="rot-bar-track"><span class="rot-bar-fill" style="width:${Math.abs(s.m1) / maxAbs * 100}%;background:${perfColor(s.m1)}"></span></span>
      <span class="rot-bar-val ${signCls(s.m1)}">${signTxt(s.m1)}</span></div>`).join("");
  return `<h4 style="margin:6px 0 4px">Performance 1 mese (ETF)</h4><div class="rot-hist">${hist}</div>`;
}

const MQ_LABELS = {
  "gdp": "PIL reale (crescita economia)",
  "claims": "Sussidi disoccupazione (mercato lavoro)",
  "cpi": "Inflazione CPI (pressioni prezzi)",
  "pce": "Inflazione PCE (consumi)",
  "retail": "Vendite al dettaglio (consumi privati)",
  "nfp": "Occupazione Non-Farm (creazione posti lavoro)",
  "unemp": "Tasso di disoccupazione",
  "credit": "Spread credito HY (rischio sistema bancario)",
  "curve": "Curva tassi 10A-2A (segnale recessione)",
  "vix": "VIX (volatilità = paura del mercato)",
  "fedwatch": "Aspettative Fed (politica monetaria)",
};
function openMacroQuantModal() {
  const mq = (DATA.macro || {}).macroquant;
  if (!mq) return;
  const rows = (mq.components || []).map(c => {
    const friendlyLab = MQ_LABELS[c.key] || MQ_LABELS[c.label?.toLowerCase()] || c.label;
    const interp = c.score >= 70 ? "Positivo per l'economia" : c.score >= 45 ? "Neutro" : "Segnale di debolezza";
    return `<tr>
      <td>${esc(friendlyLab)}</td>
      <td style="min-width:120px">${meterBar(c.score, scoreColor(c.score), String(c.score))}</td>
      <td class="muted" style="font-size:11px">${interp}</td>
    </tr>`;
  }).join("");
  const cycleDesc = mq.score >= 60
    ? "Ciclo espansivo: PIL cresce, occupazione solida, condizioni di credito normali. Favorevole per asset rischiosi (azioni, tech)."
    : mq.score >= 40
    ? "Ciclo neutro: segnali misti. Attenzione a dati macro in uscita."
    : "Rischio di recessione: PIL debole, occupazione in calo o credito sotto stress. Preferire difensivi e ridurre rischio.";
  openInfoModal(`MacroQuant — Ciclo economico: ${mq.score}%`,
    `<div class="info-line" style="margin-bottom:8px">${cycleDesc}</div>
     <div class="info-line"><b>Punteggio composito:</b> <b style="color:${scoreColor(mq.score)}">${mq.score}/100</b> — <span class="muted">100 = ciclo perfetto di crescita, 0 = recessione in atto</span></div>
     <h4 style="margin:10px 0 4px">Cosa compone il punteggio</h4>
     <table class="info-table"><thead><tr><th>Indicatore</th><th>Score</th><th>Interpretazione</th></tr></thead><tbody>${rows}</tbody></table>
     <div class="info-line muted" style="font-size:11px;margin-top:8px">Ispirato alla metodologia BCA Research. Verde = indicatore positivo per l'economia, rosso = segnale di debolezza. Aggiornato a ogni refresh dei dati.</div>`);
}

function openTiltModal() {
  const tilt = (DATA.macro || {}).tilt;
  if (!tilt || !tilt.length) return;
  const byM1 = [...tilt].sort((a, b) => b.m1 - a.m1);
  const lead = byM1.slice(0, 3), lag = byM1.slice(-3).reverse();
  const defensives = ["Utilities", "Consumi difens.", "Salute", "Oro"];
  const defAvg = avg(tilt.filter(s => defensives.includes(s.name)).map(s => s.m1));
  const tech = tilt.find(s => s.ticker === "XLK");
  const semi = tilt.find(s => s.ticker === "SMH" || s.ticker === "SOXX" || /semicond/i.test(s.name));
  const weak = byM1.filter(s => s.m1 < -2).slice(-3).map(s => s.name);
  let regimeHtml = "";
  if (defAvg != null && tech) {
    const isDef = defAvg > tech.m1;
    const col = isDef ? "var(--yellow)" : "var(--green)";
    const lab = isDef ? "ROTAZIONE DIFENSIVA" : "REGIME PRO-RISCHIO";
    const desc = isDef
      ? `I difensivi (${signTxt(Math.round(defAvg * 10) / 10)}) sovraperformano il Tech (${signTxt(tech.m1)}): gli investitori si spostano su settori protettivi — segnale di cautela o de-risking.`
      : `Tech/ciclici (${signTxt(tech.m1)}) guidano sui difensivi (${signTxt(Math.round(defAvg * 10) / 10)}): il mercato premia la crescita — contesto favorevole per il portafoglio tech.`;
    regimeHtml = `<div class="info-line" style="margin-bottom:8px"><b style="color:${col}">${lab}</b> — ${desc}</div>`;
  }
  const semiHtml = semi ? `<div class="info-line"><b>Semiconduttori:</b> <span class="${signCls(semi.m1)}">${signTxt(semi.m1)}</span> (1M) — ${semi.m1 < 0 ? "in calo: possibile finestra di accumulo sui rimbalzi (diamond hands)" : "in forza: valuta alleggerimenti sugli strappi per de-risking parziale"}</div>` : "";
  const weakHtml = weak.length ? `<div class="info-line"><b>Settori in forte debolezza</b> (potenziale mean-reversion): <b>${weak.map(esc).join(", ")}</b></div>` : "";
  openInfoModal("Rotazione settoriale USA — Analisi",
    `<div class="info-line muted" style="font-size:11px;margin-bottom:8px">Performance 1 mese degli ETF settoriali USA (Yahoo Finance). Verde = momentum positivo, rosso = debolezza. Clicca sui settori per capire il posizionamento attuale del mercato.</div>
     ${regimeHtml}
     <div class="info-line"><b>Settori in forza:</b> ${lead.map(s => `<b style="color:var(--green)">${esc(s.name)}</b> ${signTxt(s.m1)}`).join(" · ")}</div>
     <div class="info-line"><b>Settori in debolezza:</b> ${lag.map(s => `<b style="color:var(--red)">${esc(s.name)}</b> ${signTxt(s.m1)}`).join(" · ")}</div>
     ${semiHtml}
     ${weakHtml}
     ${rotationDetailHtml()}
     <div class="info-line muted" style="font-size:11px;margin-top:8px">Usa "📄 Report CIO" → Copia per analisi AI per il piano operativo dettagliato di rotazione/de-risking con indicazioni precise per ogni posizione.</div>`);
}

/* popup di orientamento rapido sulla rotazione (solo testo calcolato, NON il prompt AI) */
function openRotationAnalysis() {
  const tilt = (DATA.macro || {}).tilt;
  if (!tilt || !tilt.length) { toast("Dati rotazione non disponibili"); return; }
  const byM1 = [...tilt].sort((a, b) => b.m1 - a.m1);
  const lead = byM1.slice(0, 3), lag = byM1.slice(-3).reverse();
  const defensives = ["Utilities", "Consumi difens.", "Salute", "Oro"];
  const defAvg = avg(tilt.filter(s => defensives.includes(s.name)).map(s => s.m1));
  const tech = tilt.find(s => s.ticker === "XLK");
  const semi = tilt.find(s => s.ticker === "SMH" || s.ticker === "SOXX" || /semicond/i.test(s.name));
  const weak = byM1.filter(s => s.m1 < -2).slice(-3).map(s => s.name);
  let regime = "";
  if (defAvg != null && tech) {
    regime = defAvg > tech.m1
      ? `I settori <b>difensivi stanno sovraperformando il Tech</b> (difensivi ${signTxt(Math.round(defAvg * 10) / 10)} vs Tech ${signTxt(tech.m1)}): rotazione difensiva in corso, coerente con un de-risking dai semiconduttori.`
      : `Il <b>Tech/ciclici guida</b> sui difensivi (Tech ${signTxt(tech.m1)} vs difensivi ${signTxt(Math.round(defAvg * 10) / 10)}): regime ancora pro-rischio.`;
  }
  openInfoModal("Analisi Rotazione Settoriale", `
    <div class="info-line muted" style="font-size:11.5px;margin-bottom:8px">Orientamento rapido calcolato ora sui dati di rotazione (performance 1 mese degli ETF settoriali).</div>
    ${regime ? `<div class="info-line">${regime}</div>` : ""}
    <div class="info-line"><b>In forza (1M):</b> ${lead.map(s => `${esc(s.name)} ${signTxt(s.m1)}`).join(" · ")}</div>
    <div class="info-line"><b>In debolezza (1M):</b> ${lag.map(s => `${esc(s.name)} ${signTxt(s.m1)}`).join(" · ")}</div>
    ${weak.length ? `<div class="info-line">Settori in forte debolezza (potenziale ipervenduto / mean-reversion): <b>${weak.map(esc).join(", ")}</b></div>` : ""}
    ${semi ? `<div class="info-line"><b>Semiconduttori:</b> ${signTxt(semi.m1)} (1M) — ${semi.m1 < 0 ? "in calo: finestra per ridurre l'esposizione sui rimbalzi" : "in forza: valuta alleggerimenti sugli strappi"}</div>` : ""}
    <div class="info-line muted" style="font-size:11px;margin-top:8px">Per il piano operativo dettagliato di rotazione/de-risking usa "📄 Report CIO" → Copia per analisi AI.</div>`);
}

function openSignpostsModal() {
  const sp = (DATA.macro || {}).signposts;
  if (!sp) return;
  const rows = sp.items.map(it => `<tr>
    <td>${esc(it.name)}</td><td class="muted">${it.category}</td>
    <td><span class="badge ${it.status ? "bad" : "good"}">${it.status ? "Attivo" : "Stabile"}</span></td>
    <td class="muted" title="${esc(it.desc)}">${esc(it.source)}</td></tr>`).join("");
  openInfoModal(`BofA Bear-Market Signposts — ${sp.active}/${sp.total} attivi (${sp.pct}%)`,
    `<p class="muted" style="margin:0 0 8px">Più segnali attivi = mercato più vicino a una fase ribassista. Fonti gratuite indicate per la verifica.</p>
     <table class="info-table"><thead><tr><th>Segnale</th><th>Categoria</th><th>Stato</th><th>Fonte</th></tr></thead><tbody>${rows}</tbody></table>`);
}

/* ---------------- KPI ---------------- */
/* v204 — renderStatusBar/renderDecisionQueue RIMOSSE (decisione CEO). I dati che mostravano
   restano tutti nel payload e nelle tabelle: era una vista, non una fonte. */
function renderKPI() {
  const t = DATA.totals;
  const b = DATA.broker;
  // i totali sono calcolati da recomputeTotals usando lo snapshot reale del broker (bval/bgain)
  const controvalore = t.eur_invested;               // controvalore investimenti (no liquidità)
  const invested = t.eur_cost;                        // capitale investito (costo)
  const gain = t.eur_gain;
  const gainPct = t.eur_gain_pct;
  const net = t.eur_gain_net ?? t.eur_gain;
  const src = (b && b.as_of) ? `dati broker · agg. ${new Date(b.as_of).toLocaleDateString("it-IT")}` : "stima dai prezzi";
  // la liquidità la inserisce l'utente: patrimonio = investimenti + liquidità
  const patrimonio = controvalore + cashEur;
  const kpis = [
    { label: "Patrimonio totale (€)", value: fmtEUR.format(patrimonio),
      sub: `investimenti ${fmtEUR.format(controvalore)}${cashEur > 0 ? ` + liquidità ${fmtEUR.format(cashEur)}` : " · liquidità da inserire"}`,
      accent: "var(--blue)" },
    { label: "Capitale investito (€)", value: fmtEUR.format(invested),
      sub: src, accent: "var(--purple)" },
    { label: "Guadagno totale (€)", value: signTxt(Math.round(gain), " €"),
      sub: `${signTxt(Math.round(gainPct * 100) / 100)} sul capitale investito`,
      subCls: signCls(gain), accent: gain >= 0 ? "var(--green)" : "var(--red)", valueCls: signCls(gain) },
    { label: "Guadagno netto tasse (€)", value: signTxt(Math.round(net), " €"),
      sub: `dopo tasse stimate (26% azioni · 12,5% BTP)${b && b.cedole_btp ? ` · cedole BTP ${fmtEUR.format(b.cedole_btp)}` : ""}`,
      subCls: signCls(net), accent: net >= 0 ? "var(--green)" : "var(--red)", valueCls: signCls(net) },
  ];
  // Daily Tracking Error e Sharpe Ratio: ora mini-card con termometro tra i tab macro
  // (renderMiniCards → #tracking-error-box, #sharpe-box). Niente più KPI dedicate.

  $("#kpi-grid").innerHTML = kpis.map(k => `
    <div class="kpi${k.kpiKey ? " kpi-click" : ""}" style="--accent:${k.accent}"${k.kpiKey ? ` data-kpi="${k.kpiKey}" role="button" tabindex="0" title="Clicca per il dettaglio"` : ""}>
      <div class="label">${k.label}</div>
      <div class="value ${k.valueCls || ""}"${k.valueStyle ? ` style="${k.valueStyle}"` : ""}>${k.value}</div>
      <div class="sub ${k.subCls || ""}">${k.sub || ""}</div>
    </div>`).join("");

  // DETTAGLIO PROFITTO PER VALUTA (stile broker): azioni USD + obbligazioni EUR
  const pbc = $("#profit-by-currency");
  if (pbc) {
    const usdG = t.usd_gain, usdGp = t.usd_gain_pct;
    const btp = (DATA.portfolio || []).find(r => r.ticker === "BTP-V28");
    const btpGp = btp?.gain_pct, btpG = t.eur_btp_gain;
    const row = (lab, pct, abs, cur) => pct == null ? "" :
      `<div class="pbc-row"><span class="pbc-lab">${lab}</span>
        <span class="pbc-val ${signCls(pct)}">${signTxt(Math.round(pct * 100) / 100)} <span class="muted">(${signTxt(Math.round(abs), " " + cur)})</span></span></div>`;
    pbc.innerHTML = `<div class="pbc-head muted">Dettaglio profitto per valuta</div>
      ${row("EUR (BTP)", btpGp, btpG, "€")}
      ${row("USD (azioni)", usdGp, usdG, "$")}`;
  }

}


/* variazione % giornaliera del portafoglio = media pesata (per controvalore) dei titoli USD */
function portfolioDayPct() {
  const eq = (DATA.portfolio || []).filter(r => r.currency === "USD" && r.change_pct != null && (r.val_eur || r.value));
  const w = eq.reduce((s, r) => s + (r.val_eur || r.value || 0), 0);
  if (!w) return null;
  return eq.reduce((s, r) => s + (r.val_eur || r.value || 0) * r.change_pct, 0) / w;
}

/* popup "Portfolio Alpha vs Benchmarks": confronto Day % vs S&P/Nasdaq/SOX + forza relativa per titolo */
function openAlphaModal() {
  const bm = (DATA.macro || {}).benchmarks || {};
  const pday = portfolioDayPct();
  const BLAB = { sp500: "S&P 500", ndx: "Nasdaq 100", sox: "SOX (semiconduttori)" };
  const idxRow = (key) => {
    if (bm[key] == null) return "";
    const a = pday != null ? pday - bm[key] : null;
    return `<div class="info-line" style="display:flex;justify-content:space-between;gap:10px">
      <span><b>${BLAB[key]}:</b> <span class="${signCls(bm[key])}">${signTxt(bm[key])}</span></span>
      <span>Alpha: <span class="${signCls(a)}" style="font-family:var(--mono);font-weight:700">${a != null ? signTxt(Math.round(a * 100) / 100) + " pp" : "—"}</span></span></div>`;
  };
  const BREF = { sox: "sox", ndx: "ndx", sp500: "sp500" };
  const RLAB = { sox: "SOX", ndx: "Nasdaq 100", sp500: "S&P 500" };
  const rows = (DATA.portfolio || []).filter(r => r.currency === "USD" && r.change_pct != null).map(r => {
    const bk = BREF[r.rs_bench] || "sp500";
    const bpct = bm[bk];
    const rs = bpct != null ? r.change_pct - bpct : null;
    const c = rs != null ? scoreColor(clamp(50 + rs * 12)) : "var(--muted)";
    const bw = rs != null ? Math.max(4, Math.min(100, Math.abs(rs) * 16)) : 0;
    return `<tr><td class="name-cell" style="font-family:Inter">${r.name}<span class="tk">${r.ticker}</span></td>
      <td class="num ${signCls(r.change_pct)}">${signTxt(r.change_pct)}</td>
      <td class="num" style="color:${c};font-family:var(--mono)">${rs != null ? signTxt(Math.round(rs * 100) / 100) : "—"} <span class="muted" style="font-size:10px">(${RLAB[bk]})</span></td>
      <td><span class="alpha-bar"><span class="alpha-fill" style="width:${bw.toFixed(0)}%;background:${c}"></span></span></td></tr>`;
  }).join("");
  openInfoModal("Portfolio Alpha vs Benchmarks (Day %)", `
    <div class="info-line muted" style="font-size:11.5px;margin-bottom:8px">Alpha giornaliero = variazione % del portafoglio − variazione % dell'indice. Verde = sovraperformance, rosso = sottoperformance. La forza relativa di ogni titolo è calcolata sul benchmark del suo settore (semiconduttori→SOX, tech/growth→Nasdaq 100, finanziari/difensivi→S&P 500).</div>
    <h4 style="margin:6px 0 4px">Portafoglio vs mercato</h4>
    <div class="info-line"><b>Portafoglio oggi:</b> <span class="${signCls(pday)}" style="font-family:var(--mono);font-weight:700">${pday != null ? signTxt(Math.round(pday * 100) / 100) : "—"}</span> <span class="muted" style="font-size:11px">(media pesata per controvalore)</span></div>
    ${idxRow("sp500")}${idxRow("ndx")}${idxRow("sox")}
    <h4 style="margin:14px 0 4px">Forza relativa per titolo (Day % − benchmark di settore)</h4>
    <table class="info-table"><thead><tr><th>Titolo</th><th>Oggi</th><th>Forza rel.</th><th>Sovra/sotto-perf.</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">Dati non disponibili</td></tr>'}</tbody></table>`);
}

/* ---------------- andamento portafoglio ---------------- */
let histRange = "all";   // w1 | m1 | m3 | y1 | y5 | all — default: dall'inizio
let histBenchKey = "ndx";   // none | nasdaq | ndx | sp500 — default: confronto con Nasdaq 100
const BENCH_LABEL = { nasdaq: "Nasdaq Comp.", ndx: "Nasdaq 100", sp500: "S&P 500", russell: "Russell 2000" };

/* ---------------- info BTP (riga unica sotto i KPI) ---------------- */
function renderBtpInfo() {
  const box = $("#btp-info");
  if (!box) return;
  const cedoleInc = DATA.broker?.cedole_btp;
  // BTP Valore Ott 2028: cedola trimestrale (10 gen/apr/lug/ott), 4,10% fino a ott 2026 poi 4,50%
  const nominal = 40000, now = new Date();
  let next = null;
  for (let y = now.getFullYear(); y <= now.getFullYear() + 1 && !next; y++)
    for (const mth of [0, 3, 6, 9]) {
      const d = new Date(y, mth, 10);
      if (d > now) { next = d; break; }
    }
  const rate = next && next < new Date(2026, 9, 11) ? 0.041 : 0.045;
  const grossQ = Math.round(nominal * rate / 4), netQ = Math.round(grossQ * (1 - 0.125));
  const nextStr = next ? next.toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }) : "—";
  // niente più blocco capitale/patrimonio qui (era duplicato e in conflitto con i KPI broker in alto)
  box.innerHTML =
    `<div class="btp-line">BTP Valore Ott 2028 — ${cedoleInc != null ? `cedole incassate ${fmtEUR.format(cedoleInc)} lorde · ` : ""}prossima cedola ${nextStr}: ${fmtEUR.format(grossQ)} lordi (${fmtEUR.format(netQ)} netti, tassazione 12,5%).</div>`;
}

/* ---------------- asset allocation (donut) ---------------- */
let allocMode = "ticker";   // ticker | sector
const ALLOC_COLORS = ["#4c8dff", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444", "#22d3ee",
  "#ec4899", "#14b8a6", "#a3a3a3", "#eab308", "#6366f1"];

function renderAllocation() {
  const src = DATA.allocation || [];
  if (!src.length) { $("#alloc-donut").innerHTML = ""; $("#alloc-legend").innerHTML = ""; return; }
  let list;
  if (allocMode === "sector") {
    const by = {};
    src.forEach(x => {
      const s = x.sector || "Altro";
      (by[s] = by[s] || { value_eur: 0, gain_eur: 0, hasGain: false }).value_eur += x.value_eur;
      if (x.gain_eur != null) { by[s].gain_eur += x.gain_eur; by[s].hasGain = true; }
    });
    list = Object.entries(by).map(([name, o]) => ({
      name, ticker: "", value_eur: o.value_eur,
      gain_eur: o.hasGain ? o.gain_eur : null,
      gain_pct: (o.hasGain && (o.value_eur - o.gain_eur) > 0) ? Math.round(o.gain_eur / (o.value_eur - o.gain_eur) * 1000) / 10 : null,
    })).sort((a, b) => b.value_eur - a.value_eur);
  } else {
    list = src;
  }
  const total = list.reduce((s, x) => s + x.value_eur, 0);
  const R = 70, r = 44, cx = 80, cy = 80;
  let a0 = -Math.PI / 2;
  const arcs = list.map((x, i) => {
    const frac = x.value_eur / total;
    const a1 = a0 + frac * 2 * Math.PI;
    const large = frac > 0.5 ? 1 : 0;
    const p = (ang, rad) => `${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`;
    const d = `M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${large} 0 ${p(a0, r)} Z`;
    a0 = a1;
    return `<path d="${d}" fill="${ALLOC_COLORS[i % ALLOC_COLORS.length]}" class="alloc-arc" style="cursor:pointer"
      data-name="${esc(x.name)}" data-pct="${(frac * 100).toFixed(1)}" data-val="${Math.round(x.value_eur)}">
      <title>${esc(x.name)}: ${fmtEUR.format(x.value_eur)} (${(frac * 100).toFixed(1)}%)</title></path>`;
  }).join("");
  const totalTxt = fmtEUR.format(Math.round(total));
  $("#alloc-donut").innerHTML = `<svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="Ripartizione del portafoglio">
    ${arcs}
    <circle cx="80" cy="80" r="44" fill="transparent" id="alloc-center" style="cursor:pointer"><title>Clicca al centro per tornare al totale</title></circle>
    <text x="80" y="74" text-anchor="middle" font-size="10" fill="var(--muted)" id="alloc-c1" pointer-events="none">Totale</text>
    <text x="80" y="90" text-anchor="middle" font-size="13" font-weight="700" fill="var(--text)" id="alloc-c2" pointer-events="none">${totalTxt}</text>
    <text x="80" y="104" text-anchor="middle" font-size="9" fill="var(--muted)" id="alloc-c3" pointer-events="none"></text>
  </svg>`;
  const resetCenter = () => {
    $("#alloc-c1").textContent = "Totale";
    $("#alloc-c2").textContent = totalTxt;
    $("#alloc-c3").textContent = "";
  };
  $("#alloc-donut").querySelectorAll(".alloc-arc").forEach(pth => {
    pth.addEventListener("click", () => {
      $("#alloc-c1").textContent = pth.dataset.name;
      $("#alloc-c2").textContent = pth.dataset.pct + "%";
      $("#alloc-c3").textContent = fmtEUR.format(+pth.dataset.val);
      toast(`${pth.dataset.name}: ${pth.dataset.pct}% · ${fmtEUR.format(+pth.dataset.val)}`);
    });
  });
  $("#alloc-center").addEventListener("click", resetCenter);
  $("#alloc-legend").innerHTML = list.map((x, i) => {
    const pct = (x.value_eur / total * 100).toFixed(1);
    // guadagno/perdita della posizione: freccia verde ↑ se in gain, rossa ↓ se in perdita
    const g = x.gain_pct, ge = x.gain_eur;
    const gainHtml = (g != null && ge != null)
      ? `<span class="alloc-gain ${g >= 0 ? "pos" : "neg"}" title="P&L della posizione: ${signTxt(Math.round(ge), " €")}">${g >= 0 ? "▲" : "▼"} ${signTxt(g)} <span class="alloc-gain-eur">(${signTxt(Math.round(ge), " €")})</span></span>`
      : "";
    return `<li class="alloc-item">
      <span class="alloc-dot" style="background:${ALLOC_COLORS[i % ALLOC_COLORS.length]}"></span>
      <span class="alloc-name">${esc(x.name)} ${x.ticker ? `<span class="tk">${x.ticker}</span>` : ""}${x.ticker && x.sector ? ` <span class="muted" style="font-size:10px">(${esc(x.sector)})</span>` : ""} ${gainHtml}</span>
      <span class="alloc-pct">${pct}%</span>
      <span class="alloc-val muted">${fmtEUR.format(Math.round(x.value_eur))}</span>
    </li>`;
  }).join("");
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
   v205 — VISTA STRUTTURA
   Il vincolo che decide questa vista: i dati arrivano su cron, non tick-by-tick. Quindi NON
   si disegnano grafici di prezzo — investing.com e TradingView li fanno meglio e in tempo
   reale. Si disegna solo ciò che nessuno dei due può disegnare, perché non conosce il libro.

   ⚠ LA COSA CHE SI SBAGLIA PER PRIMA: peso e MCR hanno DENOMINATORI DIVERSI.
   La pipeline calcola il contributo al rischio solo sulle posizioni con ≥60 rendimenti
   giornalieri: il BTP non ne ha, quindi la varianza NON lo contiene. Confrontare "21% del
   NAV" con "40% della varianza del comparto azionario" è confrontare due frazioni con basi
   diverse — la classe di difetto che il gate di coerenza chiama "denominatori non dichiarati".
   Qui le due barre stanno entrambe sul COMPARTO AZIONARIO (sommano a 100% tutte e due) e il
   peso sul NAV resta accanto come numero, dichiarato per quello che è.
   ═══════════════════════════════════════════════════════════════════════════════════════ */

function strutturaUniverso() {
  const ptf = (DATA?.portfolio || []).filter(r => r.qty > 0 && r.val_eur > 0);
  const conMcr = ptf.filter(r => r.risk_contrib_pct != null);
  const somma = a => a.reduce((s, r) => s + r.val_eur, 0);
  return {
    ptf, conMcr, fuori: ptf.filter(r => r.risk_contrib_pct == null),
    investito: somma(ptf), azionario: somma(conMcr), cash: cashEur,
  };
}

/* righe del grafico peso-vs-rischio, ordinate per contributo al rischio decrescente */
function concentrazioneRows() {
  const u = strutturaUniverso();
  if (!u.azionario) return [];
  return u.conMcr.map(r => {
    const peso = Math.round(r.val_eur / u.azionario * 1000) / 10;
    return {
      ticker: r.ticker, name: r.name || r.ticker, valEur: r.val_eur,
      peso, mcr: r.risk_contrib_pct,
      pesoNav: u.investito ? Math.round(r.val_eur / u.investito * 1000) / 10 : null,
      gap: Math.round((r.risk_contrib_pct - peso) * 10) / 10,
    };
  }).sort((a, b) => b.mcr - a.mcr);
}

/* DERIVA: quota di varianza delle posizioni nel tempo, da metrics_history.
   I titoli entrano ed escono dal libro: una data senza il titolo dà un BUCO nella serie, non
   uno zero. Uno zero direbbe "rischio nullo", il buco dice "non era in portafoglio". */
function derivaConcentrazione(topN = 4) {
  const mh = (DATA?.metrics_history || []).filter(m => m?.date && m.titles && Object.keys(m.titles).length);
  if (mh.length < 2) return null;
  const dates = mh.map(m => m.date);
  const attuali = concentrazioneRows().slice(0, topN).map(r => r.ticker);
  const serie = attuali.map(tk => ({
    ticker: tk,
    punti: mh.map(m => {
      const v = m.titles[tk]?.mcr;
      return typeof v === "number" ? v : null;
    }),
  }));
  // Top-3 della giornata: la concentrazione del libro indipendentemente da CHI la produce
  const top3 = mh.map(m => {
    const vals = Object.values(m.titles).map(t => t?.mcr).filter(v => typeof v === "number");
    if (vals.length < 3) return null;
    return Math.round(vals.sort((a, b) => b - a).slice(0, 3).reduce((s, v) => s + v, 0) * 10) / 10;
  });
  return { dates, serie, top3 };
}

/* DISTANZA DALLO STOP in % del prezzo: negativa = stop già violato.
   Usa stopOf(), la stessa funzione del payload — una sola verità per dashboard e LLM. */
function distanzeStop() {
  return (DATA?.portfolio || []).filter(r => r.qty > 0 && r.price > 0 && isEquity(r))
    .map(r => {
      const s = stopOf(r);
      if (!s || !(s.stop > 0)) return null;
      return {
        ticker: r.ticker, price: r.price, stop: s.stop, ratchet: s.ratchet, src: s.src,
        violated: s.violated, valEur: r.val_eur || 0,
        dist: Math.round((r.price - s.stop) / r.price * 1000) / 10,
      };
    }).filter(Boolean).sort((a, b) => a.dist - b.dist);
}

/* allocazione per settore o per valuta — la liquidità è in euro e conta nell'esposizione */
function allocazionePer(kind) {
  const u = strutturaUniverso();
  const by = new Map();
  u.ptf.forEach(r => {
    const k = kind === "currency" ? (r.currency || "?") : (r.sector || "Altro");
    by.set(k, (by.get(k) || 0) + r.val_eur);
  });
  if (u.cash > 0) by.set(kind === "currency" ? "EUR" : "Liquidità", (by.get(kind === "currency" ? "EUR" : "Liquidità") || 0) + u.cash);
  const tot = [...by.values()].reduce((s, v) => s + v, 0);
  if (!tot) return [];
  return [...by.entries()].map(([nome, val]) => ({
    nome, val, pct: Math.round(val / tot * 1000) / 10,
  })).sort((a, b) => b.val - a.val);
}

/* v186 — quante sedute diverse convivono nel book. Rispecchia il controllo che buildPrompt fa
   sul payload; è ripetuto qui e non estratto perché buildPrompt non si tocca (Regola Suprema),
   e il test sull'impronta del payload garantisce che le due letture non divergano. */
function seduteDelBook() {
  const per = new Map();
  (DATA?.portfolio || []).filter(r => r.qty && r.currency !== "EUR" && r.price_asof)
    .forEach(r => per.set(r.price_asof, (per.get(r.price_asof) || 0) + 1));
  return per;
}

/* in una colonna di percentuali il decimale va SEMPRE stampato: "26%" accanto a "39,9%" fa
   ballare l'incolonnamento e costringe a rileggere invece di guardare */
const fmt1 = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function fmtPP(v) { return (v >= 0 ? "+" : "−") + fmt1.format(Math.abs(v)) + " pp"; }

/* ═══════════════════════════════════════════════════════════════════════════════════════
   PRIMITIVE GRAFICHE (v206)
   Due sole forme, riusate ovunque: una SERIE NEL TEMPO con le sue soglie, e BARRE ORDINATE
   che divergono dallo zero. La regola che le governa è quella che ha fatto togliere la mappa
   di correlazione: un grafico che va imparato prima di essere letto non serve a nessuno.
   Entrambe accettano buchi (null) e NON li disegnano come zeri.
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/* tacche su valori TONDI. Un asse che segna 23% e 68% costringe a fare i conti per leggerlo:
   il passo si sceglie fra 1/2/2,5/5 × una potenza di dieci, come farebbe una carta millimetrata. */
function tacche(min, max, maxTacche = 5) {
  if (!(max > min)) { const v = max || 0; return { passo: 1, lista: [v], min: v - 1, max: v + 1 }; }
  const mag = Math.pow(10, Math.floor(Math.log10((max - min) / maxTacche)));
  const passo = [1, 2, 2.5, 5, 10].map(m => m * mag).find(p => (max - min) / p <= maxTacche) || mag * 10;
  const lo = Math.floor(min / passo) * passo, hi = Math.ceil(max / passo) * passo;
  const lista = [];
  // ⚠ si RIAGGANCIA il valore al passo (Math.round(v/passo)*passo), non lo si divide per il
  // passo: la prima stesura stampava l'INDICE della tacca — un asse 0..82,5 segnava "0 1 2 3 4".
  const dec = Math.max(0, 1 - Math.floor(Math.log10(passo)));   // toglie lo 0,6000000000000001
  for (let i = 0; lo + i * passo <= hi + passo * 1e-9; i++) lista.push(+((lo + i * passo).toFixed(dec)));
  return { passo, lista, min: lo, max: hi };
}

/* etichetta di data compatta: "gen 25" per serie lunghe, "31/07" per serie brevi */
function dataBreve(iso, lunga) {
  const d = new Date(String(iso).length <= 10 ? iso + "T00:00:00" : iso);
  return isNaN(d) ? String(iso) : lunga
    ? d.toLocaleDateString("it-IT", { month: "short", year: "2-digit" })
    : d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
}

/* SERIE NEL TEMPO.
   serie: [{ nome, punti: [{d, v}|{d, v:null}], colore, tratteggio }]
   opt.soglie: [{ v, testo, colore }] — le righe orizzontali che danno significato all'altezza.
     Senza soglie un livello non dice niente: "HY OAS 2,84" è un numero, "2,84 contro i 4,0
     dello stress" è un'informazione. È il motivo per cui questi grafici esistono.
   opt.bande: [{ da, a, colore }] — zone di sfondo (es. "zona di inversione" sotto lo zero). */
function graficoSerie(serie, opt = {}) {
  const s = (serie || []).filter(x => (x.punti || []).some(p => p && p.v != null));
  if (!s.length) return '<div class="muted">Storico non disponibile.</div>';
  // ⚠ il viewBox NON è fisso: dentro una card da 300px un viewBox da 640 scala il testo al 47%
  // (9,5px → 4,5px, illeggibile). `compatto` porta la tela vicino alla larghezza reale, così
  // le etichette rendono a grandezza quasi naturale.
  const H = opt.h || 190, W = opt.w || (opt.compatto ? 330 : 640);
  const L = opt.assey === false ? 8 : (opt.lAsse || 44), R = opt.etichetteDx === false ? 12 : 52, T = 10, B = 22;
  const vals = s.flatMap(x => x.punti.map(p => p && p.v)).filter(v => v != null);
  const soglie = opt.soglie || [];
  const lo0 = Math.min(...vals, ...soglie.map(t => t.v));
  const hi0 = Math.max(...vals, ...soglie.map(t => t.v));
  const tk = tacche(lo0, hi0, opt.tacche || 4);
  const n = Math.max(...s.map(x => x.punti.length));
  const px = i => (L + (n < 2 ? 0.5 : i / (n - 1)) * (W - L - R)).toFixed(1);
  const py = v => (H - B - (v - tk.min) / (tk.max - tk.min || 1) * (H - B - T)).toFixed(1);
  const lunga = n > 90;

  const bande = (opt.bande || []).map(b =>
    `<rect x="${L}" y="${py(Math.max(b.a, b.da))}" width="${W - L - R}"
       height="${Math.abs(+py(Math.min(b.a, b.da)) - +py(Math.max(b.a, b.da))).toFixed(1)}"
       fill="${b.colore}" opacity=".13"/>`).join("");

  const griglia = tk.lista.map(v =>
    `<line x1="${L}" y1="${py(v)}" x2="${W - R}" y2="${py(v)}" stroke="var(--border)" stroke-width="1"/>
     <text x="${L - 7}" y="${(+py(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5"
       fill="var(--muted)" font-family="var(--mono)">${(opt.fmtY || fmtNum.format)(v)}${esc(opt.unita || "")}</text>`).join("");

  const righeSoglia = soglie.map(t =>
    `<line x1="${L}" y1="${py(t.v)}" x2="${W - R}" y2="${py(t.v)}" stroke="${t.colore || "var(--muted)"}"
       stroke-width="1.4" stroke-dasharray="5 3"/>
     <text x="${L + 5}" y="${(+py(t.v) - 4).toFixed(1)}" font-size="9.5" font-weight="600"
       fill="${t.colore || "var(--muted)"}">${esc(t.testo || "")}</text>`).join("");

  // un buco spezza la linea: unire i due estremi disegnerebbe una continuità mai esistita
  const linee = s.map(x => {
    const col = x.colore || "var(--blue)";
    // un punto ISOLATO fra due buchi non fa un segmento: va disegnato come punto, altrimenti
    // sparisce in silenzio dal grafico pur essendo un dato che esiste
    const segs = [], soli = []; let cur = [];
    const chiudi = () => { if (cur.length > 1) segs.push(cur); else if (cur.length === 1) soli.push(cur[0]); cur = []; };
    x.punti.forEach((p, i) => {
      if (!p || p.v == null) chiudi();
      else cur.push(`${px(i)},${py(p.v)}`);
    });
    chiudi();
    const ultimo = x.punti.reduce((acc, p, i) => (p && p.v != null ? i : acc), -1);
    const dash = x.tratteggio ? ' stroke-dasharray="4 3"' : "";
    return segs.map(g => `<polyline points="${g.join(" ")}" fill="none" stroke="${col}"
        stroke-width="${x.tratteggio ? 1.5 : 2}" stroke-linejoin="round" stroke-linecap="round"${dash}/>`).join("")
      + soli.map(p => `<circle cx="${p.split(",")[0]}" cy="${p.split(",")[1]}" r="2" fill="${col}"/>`).join("")
      + (ultimo >= 0 ? `<circle cx="${px(ultimo)}" cy="${py(x.punti[ultimo].v)}" r="3" fill="${col}"/>`
        + (opt.etichetteDx === false ? "" : `<text x="${W - R + 5}" y="${(+py(x.punti[ultimo].v) + 3.5).toFixed(1)}"
            font-size="10" font-weight="700" fill="${col}" font-family="var(--mono)">${fmtNum.format(x.punti[ultimo].v)}</text>`) : "");
  }).join("");

  // alcune serie di data.json sono NUMERI NUDI senza date (vix.spark, margin_debt.history):
  // in quel caso l'asse si etichetta a mano invece di inventare una data per punto
  const primo = s[0].punti.find(p => p && p.v != null);
  const ultimo = [...s[0].punti].reverse().find(p => p && p.v != null);
  const [xSx, xDx] = opt.assex || [primo && primo.d != null ? dataBreve(primo.d, lunga) : "",
    ultimo && ultimo.d != null ? dataBreve(ultimo.d, lunga) : ""];
  // v215 — INTERATTIVITÀ: i punti viaggiano nell'SVG come dati, così il crosshair li legge
  // senza ricalcolare nulla e senza che il grafico debba essere ridisegnato al passaggio.
  const datiHover = JSON.stringify(s.map(x => ({
    n: x.nome, c: x.colore || "var(--blue)",
    p: x.punti.map((q, i) => (q && q.v != null ? { x: +px(i), y: +py(q.v), v: q.v, d: q.d } : null)).filter(Boolean),
  })));
  return `<svg class="g-serie" data-hover='${esc(datiHover)}' data-geo='${L},${W - R},${T},${H - B}'
      viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.aria || "serie storica")}">
      ${bande}${griglia}${righeSoglia}${linee}
      <text x="${L}" y="${H - 5}" font-size="9.5" fill="var(--muted)">${esc(xSx || "")}</text>
      <text x="${W - R}" y="${H - 5}" text-anchor="end" font-size="9.5" fill="var(--muted)">${esc(xDx || "")}</text>
    </svg>`;
}

/* BARRE ORDINATE che divergono dallo zero.
   righe: [{ nome, valore, evidenzia, nota }] — `evidenzia` accende la riga (è il TUO settore,
   è il mese corrente): senza, una classifica di 21 voci resta una lista da leggere tutta. */
function barreOrdinate(righe, opt = {}) {
  const r = (righe || []).filter(x => x && x.valore != null);
  if (!r.length) return '<div class="muted">Dati non disponibili.</div>';
  const max = Math.max(...r.map(x => Math.abs(x.valore))) || 1;
  const neg = r.some(x => x.valore < 0);
  const zero = neg ? 50 : 0;      // con valori negativi lo zero sta al centro
  return `<div class="obars">${r.map(x => {
    const w = Math.abs(x.valore) / max * (neg ? 50 : 100);
    const left = x.valore >= 0 ? zero : zero - w;
    const col = x.colore || (x.valore >= 0 ? "var(--green)" : "var(--red)");
    return `<div class="obar-row${x.evidenzia ? " obar-on" : ""}"${x.tk ? ` data-obar-tk="${esc(x.tk)}"` : ""}>
      <span class="obar-lab" title="${esc(x.nome)}">${esc(x.nome)}</span>
      <span class="obar-axis">${neg ? `<span class="obar-zero" style="left:${zero}%"></span>` : ""}
        <span class="obar-fill" style="left:${left.toFixed(1)}%;width:${Math.max(w, 0.6).toFixed(1)}%;background:${col}"></span>
      </span>
      <span class="obar-val">${x.testo != null ? esc(x.testo) : signTxt(x.valore)}</span>
    </div>`;
  }).join("")}</div>${opt.nota ? `<div class="muted struct-note">${opt.nota}</div>` : ""}`;
}

/* ---------------- rendering della vista struttura ---------------- */

function renderConcentrazione() {
  const box = $("#conc-chart"); if (!box) return;
  const rows = concentrazioneRows(), u = strutturaUniverso();
  const basis = $("#conc-basis"), head = $("#conc-headline"), note = $("#conc-note");
  if (!rows.length) {
    box.innerHTML = '<div class="muted">Nessuna posizione con contributo al rischio calcolato.</div>';
    if (head) head.innerHTML = ""; if (basis) basis.textContent = ""; if (note) note.innerHTML = "";
    return;
  }
  const max = Math.max(...rows.map(r => Math.max(r.peso, r.mcr))) || 1;
  const top3 = Math.round(rows.slice(0, 3).reduce((s, r) => s + r.mcr, 0) * 10) / 10;
  const primo = rows[0];
  const violati = distanzeStop().filter(s => s.violated);

  if (basis) basis.textContent = `quote del comparto azionario · ${fmtEUR.format(Math.round(u.azionario))}`;
  // v223 — i tre cartellini (RISCHIO NEI PRIMI 3 / MASSIMO SCARTO / STOP VIOLATI) rimossi:
  // il totale dei primi tre e' gia' al centro della ciambella e gli stop hanno la loro sezione.
  if (head) head.innerHTML = "";
  const top3n = rows.slice(0, 3).map(r => r.ticker).join(" · ");
  box.innerHTML = `
    ${ciambella(rows.map(r => ({ nome: r.ticker, val: r.mcr, tk: r.ticker,
        extra: `${fmt1.format(r.peso)}% del capitale → <b>${fmt1.format(r.mcr)}% del rischio</b>` })),
      { centro: { sopra: "primi 3", grande: fmt1.format(top3) + "%", sotto: "del rischio" },
        aria: "quota della varianza per posizione" })}
    <div class="chart-legend" style="margin-top:16px">
      <span>Sopra: <b>da dove viene il rischio</b> — la fetta è la quota di varianza, non il capitale.</span>
    </div>
    <div class="chart-legend">
      <span><span class="lg-dot" style="background:var(--blue)"></span>peso nel comparto azionario</span>
      <span><span class="lg-dot" style="background:var(--purple)"></span>quota della varianza (MCR)</span>
      <span>scarto = rischio − peso</span>
    </div>
    <div class="cbars">${rows.map(r => {
      const cls = r.gap >= 10 ? "g-bad" : r.gap >= 4 ? "g-warn" : "g-ok";
      return `<div class="cbar-row">
        <span class="cbar-tk" data-struct-tk="${esc(r.ticker)}" title="${esc(r.name)} — apri la scheda">${esc(r.ticker)}</span>
        <span class="cbar-track">
          <span class="cbar-line"><span class="cbar-bar"><span class="cbar-fill f-peso" style="width:${(r.peso / max * 100).toFixed(1)}%"></span></span><span class="cbar-num">${fmt1.format(r.peso)}%</span></span>
          <span class="cbar-line"><span class="cbar-bar"><span class="cbar-fill f-mcr" style="width:${(r.mcr / max * 100).toFixed(1)}%"></span></span><span class="cbar-num">${fmt1.format(r.mcr)}%</span></span>
        </span>
        <span class="cbar-gap ${cls}" title="${fmt1.format(r.pesoNav)}% del capitale investito (BTP e liquidità inclusi)">${fmtPP(r.gap)}</span>
      </div>`;
    }).join("")}</div>`;
  box.querySelectorAll("[data-struct-tk]").forEach(e =>
    e.addEventListener("click", () => openStockCard(e.dataset.structTk)));
  if (note) {
    const fuori = u.fuori.map(r => r.ticker);
    note.innerHTML = `Entrambe le barre sono quote del <b>comparto azionario</b> e sommano a 100%: sono confrontabili.
      ${fuori.length ? `Fuori dal calcolo ${fuori.map(esc).join(", ")} e la liquidità — la varianza si calcola su chi ha una serie di rendimenti giornalieri.` : ""}
      Il comparto azionario è ${fmt1.format(Math.round(u.azionario / (u.investito + u.cash) * 1000) / 10)}% del patrimonio (investito + liquidità).
      Passa sopra allo scarto per il peso sul capitale investito.`;
  }
}

/* v238 — `renderDeriva()` RIMOSSA col suo riquadro (richiesta CEO). RICEVUTA: la funzione pura
   `derivaConcentrazione()` SOPRAVVIVE — e' usata dai check e il payload non la pubblica, quindi
   toglierla porterebbe via una protezione senza togliere nulla di visibile (classe v203). */
/* ⚠ v239 — QUESTA RIGA ERA STATA PORTATA VIA dal taglio di renderDeriva() in v238, e il sito e'
   rimasto ROTTO: `allocGrafMode is not defined` faceva morire renderAllocGrafica → renderStruttura
   → renderAll → loadData, cioe' l'intera pagina. La dichiarazione stava FRA le due funzioni, e il
   mio assert contava solo quante `function` cadevano nei confini: un `let` in mezzo non lo vedeva.
   E' la classe v201-v204 per la QUARTA volta, e stavolta e' passata perche' la ricevuta
   controllava la cosa sbagliata. La ricevuta di un taglio deve contare TUTTE le dichiarazioni di
   primo livello dentro i confini, non solo le funzioni. */
/* v251 — resta la sola modalità SETTORE: la chip "Valuta" è stata rimossa su richiesta del CEO.
   La variabile sopravvive perché `allocazionePer` la usa e perché toglierla ha già ucciso la
   pagina una volta (v238-v239): un taglio che si porta via una dichiarazione vicina. */
let allocGrafMode = "sector";
function renderAllocGrafica() {
  const box = $("#allocg-chart"); if (!box) return;
  const list = allocazionePer(allocGrafMode);
  const note = $("#allocg-note");
  if (!list.length) { box.innerHTML = '<div class="muted">Nessuna posizione.</div>'; if (note) note.innerHTML = ""; return; }
  const max = Math.max(...list.map(x => x.pct)) || 1;
  box.innerHTML = ciambella(list.map(x => ({ nome: x.nome, val: x.val, extra: fmtEUR.format(Math.round(x.val)) })),
    { centro: { sopra: allocGrafMode === "currency" ? "valuta" : "settore",
                grande: fmt1.format(list[0].pct) + "%", sotto: list[0].nome.slice(0, 16) },
      aria: "allocazione del patrimonio" });
  if (note) {
    const fx = fxExposure();
    note.innerHTML = allocGrafMode === "currency"
      ? `Quote del patrimonio per valuta di quotazione (la liquidità, se presente, è in euro). ${fx ? `L'esposizione al dollaro non coperta è <b>${fmt1.format(fx.pct)}%</b> del patrimonio: a cambio EUR/USD ${fmtNum.format(fx.eurusd)}, un movimento dell'1% sull'euro sposta ${fmtEUR.format(Math.round(fx.usdEur * 0.01))} senza che nessun prezzo si muova.` : ""}`
      : `Quote del patrimonio per settore${strutturaUniverso().cash > 0 ? ", con la liquidità come voce a sé" : " (nessuna liquidità registrata: le quote sono sul solo investito)"}.`;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
   v206 — MACRO IN GRAFICI
   Prima c'erano 34 riquadri della stessa identica forma (7 mini-card + 11 gauge + 16 tile),
   ognuno un numero con sotto un termometro 0-100: un termometro che sta ovunque non porta
   nessun segnale. E le serie storiche che il file CONTIENE non erano disegnate in dashboard
   — curve_history (501 punti), credit.history (260), vix.spark (30, mai disegnata nemmeno
   nei popup), margin_debt.history (13): tutte sepolte a due clic di distanza.
   Qui salgono in superficie tre domande, non trenta numeri:
     1. il vento è a favore o contro il MIO libro?   → rotazione settoriale
     2. il sistema è sotto stress?                   → curva, credito, volatilità
     3. quanta leva c'è, e che mese è?               → margin debt, stagionalità
   Tutto il resto resta sotto, in un blocco richiudibile: accessibile, non in primo piano.
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/* Aggancio fra i 21 ETF della rotazione e il libro. NON è un elenco scritto a mano di "cosa
   possiede il CEO": è una mappa settore→ETF di quattro voci (i settori GICS non cambiano), e
   ciò che si accende lo decide OGNI VOLTA il portafoglio vero. Se domani non ci fossero più
   semiconduttori, SMH smetterebbe di illuminarsi da solo. */
const ETF_DI_SETTORE = { sox: "SMH", Technology: "XLK", "Communication Services": "XLC", Energy: "XLE",
  "Health Care": "XLV", Financials: "XLF", Industrials: "XLI", "Consumer Discretionary": "XLY" };

function esposizioneRotazione() {
  const ptf = (DATA?.portfolio || []).filter(r => r.qty > 0 && r.val_eur > 0 && isEquity(r));
  const tot = ptf.reduce((s, r) => s + r.val_eur, 0);
  const per = new Map();
  ptf.forEach(r => {
    // i semiconduttori si riconoscono dal benchmark che la pipeline ha già scelto per la forza
    // relativa (rs_bench === "sox"), non da un elenco di ticker
    const etf = (r.rs_bench === "sox" && ETF_DI_SETTORE.sox) || ETF_DI_SETTORE[r.sector];
    if (etf) per.set(etf, (per.get(etf) || 0) + r.val_eur);
  });
  return { per, tot, quota: e => (tot ? Math.round((per.get(e) || 0) / tot * 1000) / 10 : 0) };
}

let rotOrizzonte = "m1";   // m1 | m3
function renderRotazione() {
  const box = $("#mg-rot"); if (!box) return;
  const tilt = DATA?.macro?.tilt || [];
  const nota = $("#mg-rot-note"), head = $("#mg-rot-head");
  if (!tilt.length) { box.innerHTML = '<div class="muted">Rotazione non disponibile.</div>'; return; }
  const exp = esposizioneRotazione();
  const righe = [...tilt].sort((a, b) => (b[rotOrizzonte] ?? -99) - (a[rotOrizzonte] ?? -99)).map(t => ({
    nome: t.name, valore: t[rotOrizzonte], tk: t.ticker,
    evidenzia: exp.per.has(t.ticker),
    testo: `${signTxt(t[rotOrizzonte])}${exp.per.has(t.ticker) ? `  ·  ${fmt1.format(exp.quota(t.ticker))}% del libro` : ""}`,
  }));
  box.innerHTML = barreOrdinate(righe);
  box.querySelectorAll("[data-obar-tk]").forEach(e => e.setAttribute("title",
    "ETF di riferimento " + e.dataset.obarTk + (exp.per.has(e.dataset.obarTk) ? " — settore in cui sei investito" : "")));

  // la frase che rende il grafico una risposta invece di una classifica
  const mie = righe.filter(r => r.evidenzia);
  const pos = righe.findIndex(r => r.evidenzia);
  const peggiore = [...mie].sort((a, b) => a.valore - b.valore)[0];
  const primo = righe[0], ultimo = righe[righe.length - 1];
  // v223 — via anche i tre cartellini della rotazione: la stessa cosa la dicono le barre accese.
  if (head) head.innerHTML = "";
  if (nota) {
    nota.innerHTML = `Rendimento a ${rotOrizzonte === "m1" ? "1 mese" : "3 mesi"} dei 21 ETF di settore e tema.
      <b>Le barre accese sono i settori in cui hai i soldi</b>, con accanto la quota del capitale azionario.
      ${mie.length ? `Oggi il tuo capitale è concentrato in ${mie.length} dei 21, che occupano le posizioni ${
        righe.map((r, i) => r.evidenzia ? i + 1 : null).filter(Boolean).join("ª, ")}ª della classifica.` : ""}
      ${pos > 10 ? " Stai nella metà bassa: il denaro si sta muovendo altrove." : ""}
      ${ultimo && primo ? ` L'arco della rotazione va da ${esc(primo.nome)} ${signTxt(primo.valore)} a ${esc(ultimo.nome)} ${signTxt(ultimo.valore)}.` : ""}`;
  }
}

/* I TRE TERMOMETRI DI STRESS, con le loro soglie disegnate.
   Un livello senza soglia non dice niente: "HY OAS 2,84" è un numero, "2,84 contro i 4,0 della
   tensione" è un'informazione. Le soglie sono le stesse che la pipeline già usa per gli score. */
function renderStress() {
  const m = DATA?.macro || {};
  const box = $("#mg-stress"); if (!box) return;
  const carte = [];

  if ((m.curve_history || []).length > 2) {
    const h = m.curve_history, ora = h[h.length - 1].v;
    carte.push({
      t: "Curva 10A-2A", v: `${ora > 0 ? "+" : ""}${fmtNum.format(ora)} pp`,
      cls: ora < 0 ? "neg" : ora < 0.25 ? "warn" : "pos",
      g: graficoSerie([{ nome: "curva", punti: h, colore: ora < 0 ? "var(--red)" : "var(--blue)" }],
        { h: 120, compatto: true, soglie: [{ v: 0, testo: "inversione", colore: "var(--red)" }],
          bande: [{ da: Math.min(...h.map(x => x.v)) - 0.05, a: 0, colore: "var(--red)" }],
          unita: "", aria: "spread 10 anni meno 2 anni", etichetteDx: false }),
      n: ora < 0 ? "Invertita: storicamente precede le recessioni."
        : `Positiva da ${h.filter(x => x.v < 0).length ? "dopo l'ultima inversione" : "tutto il periodo"}. Sotto lo zero è il segnale che conta.`,
    });
  }
  if ((m.credit?.history || []).length > 2) {
    const h = m.credit.history, ora = h[h.length - 1].v;
    carte.push({
      t: "Credito HY (spread)", v: `${fmtNum.format(ora)}%`,
      cls: ora >= 6 ? "neg" : ora >= 4 ? "warn" : "pos",
      g: graficoSerie([{ nome: "hy", punti: h, colore: ora >= 4 ? "var(--yellow)" : "var(--green)" }],
        { h: 120, compatto: true, soglie: [{ v: 4, testo: "tensione", colore: "var(--yellow)" }], unita: "%",
          aria: "spread high yield", etichetteDx: false }),
      n: `Quanto extra-rendimento chiede il mercato per prestare alle aziende fragili. Sopra 4% si tende, sopra 6% è stress. Ora ${fmtNum.format(ora)}%.`,
    });
  }
  if ((m.vix?.spark || []).length > 2) {
    const sp = m.vix.spark, ora = m.vix.value ?? sp[sp.length - 1];
    carte.push({
      t: "VIX — volatilità attesa", v: fmtNum.format(ora),
      cls: ora >= 30 ? "neg" : ora >= 20 ? "warn" : "pos",
      g: graficoSerie([{ nome: "vix", punti: sp.map(v => ({ d: null, v })), colore: ora >= 20 ? "var(--yellow)" : "var(--green)" }],
        { h: 120, compatto: true, soglie: [{ v: 20, testo: "tensione", colore: "var(--yellow)" }],
          assex: ["30 sedute fa", "oggi"], aria: "VIX ultime 30 sedute", etichetteDx: false }),
      n: `Sotto 20 il mercato è calmo, sopra 30 ha paura. Questa serie di 30 sedute non era disegnata da nessuna parte.`,
    });
  }
  box.innerHTML = carte.length ? carte.map(c => `<div class="mg-card">
      <div class="mg-card-head"><span class="mg-t">${esc(c.t)}</span><span class="mg-v ${c.cls}">${esc(c.v)}</span></div>
      ${c.g}<div class="muted mg-n">${c.n}</div></div>`).join("")
    : '<div class="muted">Serie di stress non disponibili.</div>';
}

/* v229 — `annoCircolare()` RIMOSSA. Era la rosa dei 12 mesi: leggibile, ma da imparare — e il
   CEO ha chiesto la stagionalita' "a barre". Dodici barre affiancate col mese corrente acceso si
   leggono senza istruzioni, ed e' la forma che aveva prima della v225.
   RICEVUTA DEL TAGLIO: 1 chiamante, convertito a barreOrdinate(); 0 riferimenti nei test; dentro
   i confini del blocco non vive nessun'altra funzione. ⚠ La prima stesura di questo assert ha
   MORSO: avevo assunto che il vicino a valle fosse renderLevaStagione(), mentre fra le due era
   stato inserito l'intero modulo v226 (FAMIGLIE_MACRO, puntiSuAsse, agganciaMacroDinamico).
   E' la terza volta in quattro versioni che la ricevuta scritta PRIMA di tagliare intercetta un
   confine sbagliato — la classe v201-v204 non e' teorica. */
/* ═══ v226 — RAGNATELA + PUNTI SU UN ASSE: il quadro, poi il dettaglio ══════════════════════
   Storia di questa decisione, perche' e' costata tre tentativi: la barra 0-100 e' stata
   respinta, il quadrante ad arco pure. La diagnosi giusta non era la FORMA del widget — era
   che ce n'erano 30 IDENTICI in fila. Nessuna forma sopravvive a essere ripetuta 30 volte.
   Il CEO ha poi chiesto GRAFICI, comprensibili e dinamici, scegliendo fra alternative rese sui
   dati veri. Qui la lettura ha due livelli e nessun widget ripetuto:
     1. la RAGNATELA: 30 indicatori in 6 famiglie, un poligono solo. Dove rientra verso il
        centro, quella parte del quadro e' debole. Si legge senza numeri, da lontano.
     2. i PUNTI SU UN ASSE: tutti sulla stessa scala 0-100, una riga per famiglia. Si vede dove
        si addensano e, cosa che nessuna media dice, quanto sono in DISACCORDO fra loro.
   Dinamici: si passa sopra un punto e compare il nome, si clicca e si apre il pannello, si
   clicca una famiglia sulla ragnatela e l'asse isola quella. */

/* v233 — RIMOSSA LA VISTA A PALLINI (FAMIGLIE_MACRO, famigliaDi, famiglieMacro, larghezzaTela,
   puntiSuAsse, agganciaMacroDinamico). Il CEO ha chiesto di riportare "Tutti gli indicatori" alla
   forma di MINI TAB: l'asse coi pallini non ha piu' chiamanti, e con lui il raggruppamento in
   famiglie che serviva solo a disporre quei pallini.
   RICEVUTA DEL TAGLIO, scritta prima di tagliare e verificata con assert: dentro i confini vivono
   esattamente quelle 5 funzioni piu' la costante; il vicino a valle, renderLevaStagione(), e'
   intatto; `larghezzaTela` era usata SOLO da radarFamiglie (v228, gia' rimossa) e da puntiSuAsse,
   quindi esce con loro.
   ⚠ E LE GUARDIE NON SI CANCELLANO CON LA FUNZIONALITA' (classe v203): i check v226 verificavano
   che NESSUN indicatore andasse perso nel raggruppamento. Quell'invariante vale ancora — ogni
   indicatore deve avere la SUA scheda — e infatti i check sono stati riscritti su quella, non
   tolti: cambia il meccanismo, non la cosa da proteggere. */
function renderLevaStagione() {
  const m = DATA?.macro || {};
  const box = $("#mg-leva"); if (!box) return;
  const carte = [];

  const md = m.margin_debt;
  if ((md?.history || []).length > 2) {
    // ⚠ history è un array di NUMERI NUDI, senza date: l'asse x si etichetta a mano coi mesi
    // che la serie copre, non si finge una data per punto
    const h = md.history, ora = h[h.length - 1];
    const picco = md.peak || Math.max(...h);
    carte.push({
      t: "Leva a credito (margin debt)", v: `${fmt1.format(md.yoy)}% a/a`,
      cls: md.yoy >= 25 ? "neg" : md.yoy >= 10 ? "warn" : "pos",
      /* ⚠ v231 — ERA `w: 900`, cioe' una tela pensata per un blocco a tutta larghezza. Dentro
         una mini tab quel viewBox NON si restringe: forzava la traccia della griglia a 990px e
         faceva collassare .mg-tris a UNA colonna sola — le due schede finivano impilate a tutta
         pagina. Non si vedeva dal viewport (nessuno sbordamento): si trova misurando la
         gridTemplateColumns risolta. Terza volta che il viewBox non-costante presenta il conto
         (v206, v226, qui). `compatto` usa la stessa tela dei termometri di stress. */
      g: graficoSerie([{ nome: "md", punti: h.map(v => ({ d: null, v })), colore: "var(--purple)" }],
        { h: 120, compatto: true, lAsse: 46, fmtY: v => fmtNum.format(Math.round(v / 1000)) + " mld",
          soglie: picco > 0 ? [{ v: picco, testo: "massimo storico", colore: "var(--red)" }] : [],
          assex: [`${h.length} mesi fa`, md.date ? dataBreve(md.date) : "oggi"], etichetteDx: false,
          aria: "debito a margine FINRA" }),
      n: `Quanto denaro a prestito c'è dentro il mercato. Oggi ${fmt1.format(md.pct_of_peak)}% del massimo storico e ${signTxt(md.yoy)} in un anno: la leva sale più in fretta dei prezzi. Fonte ${esc(md.series || "FINRA")}.`,
    });
  }
  const se = m.seasonality;
  if ((se?.sp500 || []).length === 12) {
    const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
    const cur = se.current_month;
    carte.push({
      t: "Stagionalità S&P 500", v: `${MESI[(cur || 1) - 1]} · ${se.label || ""}`,
      cls: (se.sp500[(cur || 1) - 1]?.avg ?? 0) < 0 ? "warn" : "pos",
      /* v229 — TORNA A BARRE su richiesta del CEO. La rosa circolare era leggibile ma va
         imparata; dodici barre affiancate, una per mese, con quello corrente acceso, si
         leggono senza istruzioni. Divergono dallo zero perche' il segno E' l'informazione. */
      g: barreOrdinate(se.sp500.map(x => ({
        nome: MESI[x.m - 1], valore: x.avg, evidenzia: x.m === cur,
        testo: `${signTxt(x.avg)} · ${Math.round(x.pos)}% anni positivi`,
      })), {}),
      n: `Rendimento medio di ogni mese su ~${se.sp500[0]?.n || 40} anni, con il mese corrente acceso. È contesto di probabilità, non una previsione.`,
    });
  }
  /* v231 — MINI TAB da "Leva e stagionalità" in giù (richiesta CEO). `mg-wide` fa
     grid-column: 1/-1, cioè trasformava queste schede in blocchi a tutta larghezza: tolto, la
     griglia .mg-tris le rimette affiancate. I GRAFICI RESTANO DENTRO — margin debt tiene la sua
     serie storica, la stagionalità le sue 12 barre: "se quelle all'interno portavano dei grafici
     con le informazioni riporta direttamente quelle". Cambia il contenitore, non il contenuto. */
  box.innerHTML = carte.length ? carte.map(c => `<div class="mg-card">
      <div class="mg-card-head"><span class="mg-t">${esc(c.t)}</span><span class="mg-v ${c.cls}">${esc(c.v)}</span></div>
      ${c.g}<div class="muted mg-n">${c.n}</div></div>`).join("")
    : '<div class="muted">Dati non disponibili.</div>';
}

/* v238 — `renderScomposizione()` e la costante COMPOSITI RIMOSSE col loro riquadro.
   RICEVUTA DEL TAGLIO, verificata con assert: dentro i confini vive UNA sola funzione piu' la
   costante; il vicino a valle, renderSignposts(), e' intatto.
   ⚠ IL CONTENUTO NON E' PERSO: le barre dei fattori di ogni composito sono ora dentro la scheda
   del rispettivo indicatore (FORMA_INDICATORE → barreComposito). Prima quei nomi comparivano DUE
   volte, una nella classifica e una qui: e' la classe v184, lo stesso dato presentato come due. */
/* v243 — `renderSignposts()` RIMOSSA col suo riquadro (richiesta CEO).
   RICEVUTA DEL TAGLIO: dentro i confini vive UNA sola dichiarazione di primo livello, verificata
   contando function/const/let/var e non solo le function — la svista che in v238 ha portato via
   `let allocGrafMode` e ucciso la pagina. Il vicino a valle, renderMacroGrafici(), e' intatto.
   ⚠ IL DATO NON E' PERSO: macro.signposts resta in data.json e la riga "BofA Bear-Market
   Signposts: N/10 attivi" resta nel payload. Si e' tolta la resa, non l'informazione. */
function renderMacroGrafici() {
  if (!DATA) return;
  attivaHoverGrafici();
  renderRotazione();
  renderStress();
  renderLevaStagione();
  renderIndicatori();   // v215 — le 27 scatole diventano una classifica sola
  // v235 — ORA le schede esistono: si misura e si impacca
  impaccaGriglia(document.querySelector(".shell-main"));
}


/* ═══ v214 — IL FONDO CONTRO IL SUO INDICE ════════════════════════════════════════════════
   È la domanda del mandato ("crescita composta vs NDX") e non era disegnata da nessuna parte:
   viveva come tachimetro in una mini-card che mostrava lo scarto di UN GIORNO. La serie c'è —
   history.m3 porta 66 date con il valore del fondo e quello dell'indice — e rebasata a 100
   sulla stessa data risponde a colpo d'occhio: la distanza fra le due linee È l'alpha.
   ⚠ Le due serie condividono per costruzione date e punto di partenza (stesso array), quindi
   qui il problema delle finestre disallineate di v207 non si pone. */
function renderVsBenchmark() {
  const box = $("#bench-chart"); if (!box) return;
  const nota = $("#bench-note"), head = $("#bench-head");
  const H = DATA?.history || {};
  const per = benchOrizzonte;
  const h = H[per];
  if (!h || !(h.values || []).length || !(h.ndx || []).length || h.values.length < 3) {
    box.innerHTML = '<div class="muted">Storico non disponibile per questo orizzonte.</div>';
    if (head) head.innerHTML = ""; if (nota) nota.innerHTML = "";
    return;
  }
  const base = (a) => { const b0 = a.find(v => v > 0); return b0 ? a.map(v => (v > 0 ? v / b0 * 100 : null)) : null; };
  const f = base(h.values), n = base(h.ndx);
  if (!f || !n) { box.innerHTML = '<div class="muted">Serie non normalizzabile.</div>'; return; }
  const d = h.dates || [];
  const punti = (arr) => arr.map((v, i) => ({ d: d[i] || null, v }));
  box.innerHTML = graficoSerie([
    { nome: "Fondo", punti: punti(f), colore: "var(--blue)" },
    { nome: "Nasdaq 100", punti: punti(n), colore: "var(--muted)", tratteggio: true },
  ], { h: 200, w: 760, soglie: [{ v: 100, testo: "partenza", colore: "var(--border)" }],
       aria: "fondo contro Nasdaq 100, base 100" })
    + `<div class="chart-legend" style="margin-top:8px">
         <span><span class="lg-dot" style="background:var(--blue)"></span>il tuo fondo</span>
         <span><span class="lg-dot" style="background:var(--muted)"></span>Nasdaq 100</span>
         <span>entrambi a 100 il ${d[0] ? dataBreve(d[0], true) : ""}</span></div>`;
  const fF = f[f.length - 1], nF = n[n.length - 1], alpha = Math.round((fF - nF) * 10) / 10;
  if (head) {
    head.innerHTML = `
      <div class="sh-item ${alpha < 0 ? "sh-bad" : ""}">
        <div class="sh-lab">Scarto dal Nasdaq</div>
        <div class="sh-val ${alpha >= 0 ? "pos" : "neg"}">${fmtPP(alpha)}</div>
        <div class="sh-sub">nel periodo, a parità di punto di partenza</div>
      </div>
      <div class="sh-item">
        <div class="sh-lab">Il tuo fondo</div>
        <div class="sh-val ${fF >= 100 ? "pos" : "neg"}">${signTxt(Math.round((fF - 100) * 10) / 10)}</div>
        <div class="sh-sub">${d.length} rilevazioni</div>
      </div>
      <div class="sh-item">
        <div class="sh-lab">Nasdaq 100</div>
        <div class="sh-val ${nF >= 100 ? "pos" : "neg"}">${signTxt(Math.round((nF - 100) * 10) / 10)}</div>
        <div class="sh-sub">stesso periodo</div>
      </div>`;
  }
  if (nota) {
    nota.innerHTML = `Le due linee partono dallo stesso punto: <b>la distanza fra loro è l'alpha</b>, e non serve sottrarre due percentuali a mente.
      ${alpha >= 0 ? "Sopra la linea grigia il processo sta aggiungendo valore rispetto al semplice comprare l'indice." : "Sotto la linea grigia l'indice avrebbe fatto meglio: è il metro che il mandato ha scelto."}
      ⚠ Il valore del fondo include il BTP (volatilità ~0) e l'effetto cambio su un NAV in larga parte in dollari: su finestre corte il segno può dipendere da quelli prima che dalla selezione dei titoli.`;
  }
}
let benchOrizzonte = "m3";

/* ═══ v215 — TUTTI GLI INDICATORI, UNA SOLA CLASSIFICA ════════════════════════════════════
   Fin qui avevo CANCELLATO le mini-card che duplicavano un grafico, ma ne restavano 27
   intatte (11 tachimetri + 16 riquadri) dentro il blocco richiudibile: la richiesta era
   esploderle TUTTE come grafici, non nasconderle. Il problema di 27 scatole ognuna con il suo
   numero e il suo termometro è che non sono confrontabili: ogni termometro ha la sua scala
   mentale. Qui diventano UNA classifica sola sullo stesso asse 0-100 (100 = favorevole al
   libro), ordinata dal peggiore al migliore, dove si legge in un secondo che cosa pesa.
   Ogni barra è cliccabile e apre il suo pannello di dettaglio. */
const IND_TITOLI = {
  fear_greed: "Fear & Greed (sentiment)", risk_sentiment: "Sentiment globale",
  credit: "Credito high yield", systemic_risk: "Stress sistemico del credito",
  corp_profit: "Borsa vs profitti reali", sp500_pe: "Valutazione S&P (P/E)",
  smart_money: "Istituzionali vs retail",
  /* ⚠ v252 — "Ciclo economico" RIMOSSO dalla classifica su richiesta del CEO: i suoi TREDICI
     componenti hanno già ognuno la propria scheda (dodici le avevano, il VIX gliel'ho data in
     v251), quindi la scheda del ciclo era un tredicesimo riquadro che ripeteva gli altri
     dodici sotto forma di barre. Il PUNTEGGIO resta calcolato dalla pipeline e resta nel
     payload: è una sintesi utile a chi legge, ma in dashboard duplicava. */
  seasonality: "Stagionalità del mese", thermometer: "Salute tecnica del libro",
};
/* ⚠ v251 — IL VIX NON AVEVA UNA SCHEDA PROPRIA. Il CEO ha chiesto che ogni variabile del Ciclo
   economico ne abbia una: confrontando i 13 componenti con le 27 schede, dodici c'erano già
   (alcune accorpate: CPI+PCE in una, NFP e disoccupazione dentro il mercato del lavoro, il
   credito in "Stress del credito", lo smart money in "Istituzionali vs retail") e UNO no.
   Il VIX vive in `macro.vix`, che non ha un campo `score`: gliene serve uno per entrare nella
   classifica, ed è la stessa formula che il ciclo economico usa già per pesarlo — non una
   scala nuova inventata qui. */
function vixComeIndicatore(m) {
  const v = m && m.vix;
  if (!v || v.value == null) return null;
  return { k: "vix", nome: "Volatilità (VIX)",
           score: Math.round(Math.max(0, Math.min(100, 100 - v.value / 50 * 100))),
           sub: `${fmtNum.format(v.value)}${v.change_pct != null ? ` (${signTxt(v.change_pct)} oggi)` : ""}` };
}
function indicatoriClassifica() {
  const m = DATA?.macro || {}, out = [];
  { const vx = vixComeIndicatore(m); if (vx) out.push(vx); }   // v251
  Object.entries(IND_TITOLI).forEach(([k, nome]) => {
    const v = m[k];
    if (v && v.score != null) out.push({ k, nome, score: Math.round(v.score), sub: v.label || v.status || v.rating || "" });
  });
  (m.indicators || []).forEach(i => {
    /* v250 — la card porta la CADENZA: quando è stato rilevato, quanti giorni ha, quando ne
       arriva uno nuovo. Richiesta del CEO dopo il dubbio sul margin debt — un dato vecchio con
       la data del prossimo è informazione, lo stesso dato senza è una trappola. */
    if (i.impact != null) out.push({ k: "in:" + i.key, nome: i.label, score: Math.round(i.impact),
      sub: `${i.value}${i.date ? " · " + i.date : ""}`, cadenza: rigaCadenza(i.key, i.date) });
  });
  (m.markets || []).forEach(i => {
    const sc = marketImpact(i);
    if (sc != null) out.push({ k: "mk:" + i.key, nome: i.label, score: Math.round(sc), sub: `${i.value} (${signTxt(i.change_pct, i.suffix || "%")} oggi)` });
  });
  // ⚠ v222 — GLI UNDICI ORFANI. Togliendo i riquadri (v217) E il popup dei dettagli (v219) ho
  // lasciato SENZA CASA undici indicatori che prima erano visibili: carry, put/call, liquidità
  // in attesa, righello dollaro, Fed funds, curva-vs-recessione, disaccoppiamento, forward P/E,
  // FedWatch, streghe, scarto vs indice. NON erano duplicati di un grafico: erano informazione,
  // e l'ho fatta sparire. Rientrano qui, sulla stessa scala 0-100 (100 = favorevole al libro):
  // non torna il riquadro, torna il DATO in forma confrontabile con tutti gli altri.
  const cl = (x) => Math.round(Math.max(0, Math.min(100, x)));
  const orf = [];
  if (m.carry?.spread != null) orf.push({ k: "carry", nome: "Carry USA-Giappone",
    score: cl(50 + (m.carry.spread - 2) * 15),
    sub: `spread ${fmtNum.format(m.carry.spread)} pp${m.carry.usdjpy != null ? ` · USD/JPY ${fmtNum.format(m.carry.usdjpy)}` : ""}` });
  if (m.putcall?.ratio != null) orf.push({ k: "putcall", nome: "Put/Call ratio (SPY)",
    score: cl(100 - (m.putcall.ratio - 0.7) / 0.008),
    sub: `${fmtNum.format(m.putcall.ratio)} — sopra 1 più copertura che scommessa` });
  if (m.liquidity_split?.retail_mmf_bln != null) orf.push({ k: "liquidity", nome: "Liquidità in attesa (dry powder)",
    score: cl(40 + (m.liquidity_split.retail_pctile_5y ?? 50) * 0.4),
    sub: `fondi monetari $${fmtNum.format(Math.round(m.liquidity_split.retail_mmf_bln))} mld${m.liquidity_split.retail_yoy_pct != null ? ` · YoY ${signTxt(m.liquidity_split.retail_yoy_pct)}` : ""}` });
  if (m.dollar_ruler?.value != null) orf.push({ k: "dollar", nome: "Righello dollaro (DXY)",
    score: cl(50 - (m.dollar_ruler.chg_3m_pct ?? 0) * 6),
    sub: `${fmtNum.format(m.dollar_ruler.value)} · 3 mesi ${signTxt(m.dollar_ruler.chg_3m_pct ?? 0)}` });
  if (m.fed_market?.current_rate != null) orf.push({ k: "fed_market", nome: "Tasso Fed Funds",
    score: cl(100 - (m.fed_market.current_rate - 1) * 20),
    sub: `${fmtNum.format(m.fed_market.current_rate)}% — sopra il 4% comprime i multipli` });
  if (m.yield_recession?.current != null) orf.push({ k: "yield_recession", nome: "Curva vs recessione",
    score: cl(50 + m.yield_recession.current * 60),
    sub: `spread ${signTxt(m.yield_recession.current, " pp")} · ${m.yield_recession.was_inverted_24m ? "invertita negli ultimi 24 mesi" : "nessuna inversione recente"}` });
  if ((m.decouple?.sp500 || []).length && (m.decouple?.gdp || []).length) {
    const gapD = Math.round(m.decouple.sp500.slice(-1)[0].v - m.decouple.gdp.slice(-1)[0].v);
    orf.push({ k: "decouple", nome: "Borsa vs economia reale", score: cl(100 - gapD * 0.9),
      sub: `gap ${signTxt(gapD, " pp")} su 3 anni — cumulato, cresce con la finestra` });
  }
  if (m.forward_pe?.value != null) orf.push({ k: "forward_pe", nome: "Valutazione S&P (P/E forward)",
    score: cl(100 - (m.forward_pe.value - 13) * 8),
    sub: `${fmtNum.format(m.forward_pe.value)}× vs media storica ${fmtNum.format(m.forward_pe.avg ?? 16.5)}×` });
  if ((m.fedwatch?.meetings || []).length) {
    const rf = ramiFedWatch(m.fedwatch, m.fedwatch.meetings[0]);
    orf.push({ k: "fedwatch", nome: "Attese sui tassi (prossimo FOMC)",
      score: cl(50 + (rf.cut_prob ?? 0) * 0.5 - (rf.hike_prob ?? 0) * 0.5),
      sub: `rialzo ${rf.hike_prob ?? 0}% · invariato ${rf.hold_prob ?? 0}% · taglio ${rf.cut_prob ?? 0}%` });
  }
  if (m.witching?.days != null) orf.push({ k: "witching", nome: "Prossima scadenza tecnica",
    score: m.witching.days <= 5 ? 30 : m.witching.days <= 15 ? 45 : 62,
    sub: `fra ${m.witching.days} giorni — volatilità attesa attorno alla data` });
  const bmk = m.benchmarks, pdOggi = typeof portfolioDayPct === "function" ? portfolioDayPct() : null;
  if (bmk && pdOggi != null) {
    const rif = bmk.sp500 ?? bmk.ndx ?? bmk.sox;
    if (rif != null) orf.push({ k: "_alpha", nome: "Scarto di oggi vs indice",
      score: cl(50 + (pdOggi - rif) * 12), sub: `${signTxt(Math.round((pdOggi - rif) * 100) / 100, " pp")} nella seduta` });
  }
  orf.forEach(x => out.push(x));


  /* ═══ v225 — ACCORPAMENTO: due tessere per la stessa cosa sono due tessere di troppo ══════
     Diverse voci misurano la STESSA grandezza con un secondo denominatore, e finivano affiancate
     come se fossero due letture indipendenti — la classe di difetto che questo progetto insegue
     da versioni (contare due volte un segnale solo). Qui si fondono in una tessera che porta
     entrambi i numeri: il punteggio e' quello della voce PRINCIPALE, l'altra diventa contesto. */
  const FUSIONI = [
    { p: "in:cpi", s: "in:pce", nome: "Inflazione (CPI e PCE)",
      sub: (a2, b2) => `CPI ${a2.sub.split(" ")[0]} · PCE ${b2.sub.split(" ")[0]} — due misure della stessa cosa, la Fed guarda il PCE` },
    { p: "credit", s: "systemic_risk", nome: "Stress del credito",
      sub: (a2, b2) => `${a2.sub} · stress sistemico ${b2.score}/100 — stessa famiglia, spread HY e IG` },
    { p: "sp500_pe", s: "forward_pe", nome: "Valutazione S&P (trailing e forward)",
      sub: (a2, b2) => `${a2.sub} · forward ${b2.sub}` },
    { p: "corp_profit", s: "decouple", nome: "Borsa vs economia reale",
      sub: (a2, b2) => `${a2.sub} · e contro il PIL: ${b2.sub} — NON due prove, la stessa su due denominatori` },
    { p: "in:unemp", s: "in:nfp", nome: "Mercato del lavoro",
      sub: (a2, b2) => `disoccupazione ${a2.sub.split(" ")[0]} · nuovi posti ${b2.sub.split(" ")[0]}` },
    { p: "in:curve", s: "yield_recession", nome: "Curva dei tassi 10A-2A",
      sub: (a2) => `${a2.sub} — sotto zero e' il segnale che conta` },
  ];
  for (const f of FUSIONI) {
    const ip = out.findIndex(x => x.k === f.p), is = out.findIndex(x => x.k === f.s);
    if (ip < 0 || is < 0) continue;
    const A = out[ip], B = out[is];
    A.nome = f.nome;
    try { A.sub = f.sub(A, B); } catch { /* sub assente: si tiene quello originale */ }
    out.splice(is, 1);
  }

  // v218 — gli INTERNI DI MERCATO erano l'ultima mini-card: quattro righe di valori con unità
  // diverse (pp, %, un booleano) che nessuno poteva confrontare fra loro. Portati sulla stessa
  // scala 0-100 entrano nella classifica insieme a tutto il resto, e la mini-card sparisce.
  if (m.breadth?.divergence_pp != null) out.push({ k: "breadth", nome: "Ampiezza del mercato (SPY vs RSP)",
    score: Math.round(clamp(50 + m.breadth.divergence_pp * 8)), sub: `${signTxt(m.breadth.divergence_pp, " pp")} a 1 mese` });
  if (m.momentum?.sp500?.dist_pct != null) out.push({ k: "momentum", nome: "S&P vs media 125 sedute",
    score: Math.round(clamp(50 + m.momentum.sp500.dist_pct * 4)), sub: signTxt(m.momentum.sp500.dist_pct) });
  if (m.froth) out.push({ k: "froth", nome: "Schiuma sugli ETF a leva",
    score: m.froth.alert ? 18 : 78, sub: m.froth.alert ? "volumi anomali dentro un rialzo" : `volumi normali (RVol max ${fmtNum.format(Math.max(m.froth.soxl?.rvol ?? 0, m.froth.tqqq?.rvol ?? 0))}×)` });
  if (m.futures?.nasdaq?.change_pct != null) out.push({ k: "futures", nome: "Futures Nasdaq (fuori orario)",
    score: Math.round(clamp(50 + m.futures.nasdaq.change_pct * 10)), sub: signTxt(m.futures.nasdaq.change_pct) });
  /* ⚠ v238 — IL FILTRO VA QUI, non a meta' funzione: la prima stesura lo metteva subito dopo
     gli "orfani" e "futures" veniva aggiunto DOPO, quindi sopravviveva. Misurato: 30 voci → 28
     invece di 27. In fondo, appena prima dell'ordinamento, vede tutto quello che e' stato messo.
     TRE VOCI ESCONO su richiesta del CEO: "Salute tecnica del libro" e "Futures Nasdaq (fuori
     orario)" eliminate; "Stagionalità del mese" e' la STESSA cosa del riquadro "Leva e
     stagionalità", che pero' ha i 12 mesi disegnati — si tiene quello col grafico e si toglie il
     doppione, che diceva lo stesso fatto con meno informazione (classe v184). */
  const FUORI = new Set(["thermometer", "futures", "seasonality"]);
  /* ⚠ v253 — LA FRESCHEZZA SI ASSEGNA IN UN PUNTO SOLO, QUI IN FONDO. La prima stesura la
     agganciava ai singoli `out.push`: ce ne sono NOVE sparsi per la funzione, e un decimo
     aggiunto un domani nascerebbe senza — è lo stesso motivo per cui il filtro FUORI qui
     sopra è stato spostato in fondo in v238 ("futures" veniva aggiunto DOPO e sopravviveva).
     Chi ha già un calendario di pubblicazione (rigaCadenza) se lo tiene; tutti gli altri
     sono dati che rinascono a ogni run, e questa riga lo dice. */
  const mercato = rigaFreschezzaMercato();
  return out.filter(x => !FUORI.has(x.k))
    .map(x => (x.cadenza ? x : { ...x, cadenza: mercato }))
    .sort((a, b) => a.score - b.score);
}
/* ═══ v233 — QUELLO CHE IL POPUP AVEVA DENTRO, PORTATO FUORI ════════════════════════════════
   Richiesta CEO: "i grafici riportali all'originaria forma di mini tab e se il rispettivo pop up
   forniva dei grafici o tabelle, riporta direttamente quelli in struttura".
   La macchina esiste gia' dal v188: `collectPanels` sostituisce temporaneamente `openInfoModal`
   con un raccoglitore, esegue la funzione del pannello e ne tiene l'HTML — cosi' ogni pannello
   resta l'UNICA fonte di verita' del proprio contenuto e non nasce un secondo elenco da tenere
   allineato (la classe di difetto C10/C12).
   Qui si estraggono SOLO gli elementi che portano dati — <svg> e <table> — e si lascia fuori la
   prosa esplicativa, che nella scheda sarebbe rumore e nel popup resta a un clic.
   ⚠ MISURATO PRIMA DI SCRIVERE: su 30 indicatori solo 3 hanno un grafico e 4 una tabella. Gli
   altri 23 non prendono un riempitivo: la mini tab col numero e la sua nota e' tutto quello che
   c'e', e dirlo e' meglio che inventare una forma per far sembrare pieni i riquadri vuoti. */
function contenutoDalPannello(k, notaGia = "") {
  if (!k || typeof MACRO_INFO === "undefined" || !MACRO_INFO[k]) return "";
  let html = "";
  try {
    const p = collectPanels([{ run: () => openMacroInfo(k) }]);
    html = p.length ? (p[0].bodyHTML || "") : "";
  } catch { return ""; }                      // un pannello rotto non deve rompere la griglia
  /* ⚠ v235 — NON SOLO GRAFICI E TABELLE. Misurato sui pannelli veri: 4 hanno un <svg>, 4 una
     <table>, ma VENTUNO su 30 hanno righe `info-line` — che sono i dati veri e propri ("Valore
     attuale: 55.2 (2026-07-01)", "Impatto: sfavorevole ai mercati", "Prossima pubblicazione
     stimata: …"). In v233 restavano dentro il popup, e la scheda mostrava il solo punteggio.
     Il CEO ha indicato "Istituzionali vs retail" come esempio: quel pannello ha una tabella E
     nove righe di dati, e usciva solo la tabella. Ora esce tutto il CONTENUTO INFORMATIVO;
     resta dentro solo la prosa esplicativa (cos'e' l'indicatore, come si legge), che nella
     scheda sarebbe rumore e nel popup e' a un clic. */
  /* ⚠ v237 — LO STESSO DATO NON VA MOSTRATO DUE VOLTE. Misurato in browser dopo la v235: 8
     schede su 30 dicevano il valore corrente nella NOTA e di nuovo nella riga estratta —
     "55.2 · 2026-07-01" e sotto "Valore attuale: 55.2 (2026-07-01)". E' esattamente la classe
     che questo payload combatte altrove ("lo stesso dato che si presentava come due dati", v184)
     e l'ho introdotta io portando fuori le righe senza confrontarle con quello che la scheda
     gia' diceva. Ora una riga che non aggiunge NIENTE alla nota viene scartata. */
  /* ⚠ i numeri vanno NORMALIZZATI prima di confrontarli: la nota scrive "4.69" (formato del
     dato) e il pannello "4,69%" (formato italiano). Confrontando le stringhe grezze il filtro
     non riconosceva la ripetizione, ed e' per questo che sulla scheda del carry gli stessi
     valori comparivano due volte. Si tolgono i separatori e si confrontano le cifre. */
  const norm = (x) => String(x).replace(/[.,]/g, "");
  const numeriNota = (String(notaGia).match(/[\d][\d.,]{1,}/g) || [])
    .filter(x => x.length > 2).map(norm);
  /* ⚠ v243 — il filtro guardava solo le righe etichettate "Valore attuale / Rilevazione / Ultimo
     dato". Ma la ridondanza non dipende dall'ETICHETTA: sulla scheda del carry le righe del
     pannello ("Treasury 10A: 4,69% · JGB 10A: 2,82% · Differenziale 1,88 pp") ripetevano
     esattamente i numeri della nota due righe sotto, con etichette diverse. Il criterio vero e'
     numerico: se TUTTI i numeri di una riga sono gia' nella nota, quella riga non aggiunge nulla.
     Resta prudente — basta UN numero nuovo perche' la riga sopravviva. */
  const ridondante = (frammento) => {
    const testo = frammento.replace(/<[^>]*>/g, " ");
    if (/<svg|<table/.test(frammento)) return false;      // grafici e tabelle non si scartano mai
    const numeri = (testo.match(/[\d][\d.,]{1,}/g) || []).filter(x => x.length > 2).map(norm);
    return numeri.length > 0 && numeri.every(n => numeriNota.includes(n));
  };
  const pezzi = [...html.matchAll(/<svg[\s\S]*?<\/svg>|<table[\s\S]*?<\/table>|<div class="info-line[\s\S]*?<\/div>/g)]
    .map(m => m[0]).filter(x => !ridondante(x));
  return pezzi.length ? `<div class="mg-dalpan">${pezzi.join("")}</div>` : "";
}

/* ═══ v238 — LA SCALA: un valore singolo non e' un numero nudo, e' una POSIZIONE ═════════════
   Richiesta CEO: "fornisci dati dettagliati e spiegazioni di lettura del dato, se possibile con
   grafico, istogramma, torta o termometro" per sedici indicatori che hanno UN solo valore e
   nessuno storico nel file.
   ⚠ Perche' NON e' la barra 0-100 gia' respinta tre volte: quella chiedeva di stimare una
   lunghezza contro un asse implicito e senza riferimenti. Qui l'asse porta le ZONE NOMINATE
   (dove comincia la recessione, dov'e' il target della Fed, dove i multipli si comprimono) e la
   lettura e' la POSIZIONE dentro una di esse. Il numero non e' il messaggio: lo e' la zona in
   cui cade, che ha un nome scritto sotto. */
function scala(v, opt = {}) {
  if (v == null || isNaN(v)) return "";
  const zone = (opt.zone || []).filter(z => z && z.a > z.da);
  if (!zone.length) return "";
  const min = opt.min != null ? opt.min : Math.min(...zone.map(z => z.da));
  const max = opt.max != null ? opt.max : Math.max(...zone.map(z => z.a));
  if (!(max > min)) return "";
  const W = 320, H = 62, L = 6, R = W - 6, y = 26, alt = 13;
  const X = (x) => L + (Math.max(min, Math.min(max, x)) - min) / (max - min) * (R - L);
  const fasce = zone.map(z => `<rect x="${X(z.da).toFixed(1)}" y="${y}" width="${(X(z.a) - X(z.da)).toFixed(1)}"
      height="${alt}" fill="${z.colore}" fill-opacity=".55"><title>${esc(z.nome)}</title></rect>`).join("");
  const conf = (opt.soglie || []).filter(t => t && t.v > min && t.v < max).map(t =>
    `<line x1="${X(t.v).toFixed(1)}" y1="${y - 4}" x2="${X(t.v).toFixed(1)}" y2="${y + alt + 4}"
       stroke="var(--text)" stroke-width="1" stroke-dasharray="2 2" opacity=".7"/>
     <text x="${X(t.v).toFixed(1)}" y="${y - 7}" text-anchor="middle" font-size="8.5" fill="var(--muted)">${esc(t.testo)}</text>`).join("");
  const px = X(v);
  const fmt = opt.fmt || ((x) => fmtNum.format(x));
  // il valore si scrive dove sta il marcatore, ma senza uscire dalla tela
  const tx = Math.max(L + 22, Math.min(R - 22, px));
  const dentro = zone.find(z => v >= z.da && v <= z.a);
  return `<div class="sc"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.aria || "scala")}: ${fmt(v)}">
      ${fasce}${conf}
      <polygon points="${px.toFixed(1)},${y - 2} ${(px - 4).toFixed(1)},${y - 9} ${(px + 4).toFixed(1)},${y - 9}" fill="var(--text)"/>
      <line x1="${px.toFixed(1)}" y1="${y - 2}" x2="${px.toFixed(1)}" y2="${y + alt + 2}" stroke="var(--text)" stroke-width="1.8"/>
      <text x="${tx.toFixed(1)}" y="${y + alt + 15}" text-anchor="middle" font-size="12" font-weight="700"
        font-family="var(--mono)" fill="var(--text)">${esc(fmt(v))}${esc(opt.unita || "")}</text>
      <text x="${L}" y="${y - 7}" font-size="8.5" fill="var(--muted)">${esc(fmt(min))}</text>
      <text x="${R}" y="${y - 7}" text-anchor="end" font-size="8.5" fill="var(--muted)">${esc(fmt(max))}</text>
    </svg>${dentro ? `<div class="sc-zona" style="color:${dentro.colore}">${esc(dentro.nome)}</div>` : ""}
    <div class="sc-fonte muted">${esc(opt.fonte || "bande di lettura convenzionali, non soglie calcolate dai dati")}</div></div>`;
}

/* conto alla rovescia per le date: un numero di giorni e' un fatto, la sequenza delle prossime
   scadenze e' il contesto che dice se quella data e' isolata o parte di un ritmo */
function contoAllaRovescia(giorni, date, opt = {}) {
  if (giorni == null) return "";
  const el = (date || []).slice(0, 4);
  return `<div class="cdr"><div class="cdr-n">${giorni}<span class="cdr-u">giorni</span></div>
    ${el.length ? `<div class="cdr-el">${el.map((d, i) => `<span class="${i === 0 ? "cdr-on" : ""}">${esc(dataBreve(d))}</span>`).join("")}</div>` : ""}
    ${opt.nota ? `<div class="muted cdr-nota">${opt.nota}</div>` : ""}</div>`;
}

/* ═══ v243 — IL TACHIMETRO: cinque strumenti, non trenta ════════════════════════════════════
   Richiesta CEO: un tachimetro per carry USA-Giappone, Fear & Greed, istituzionali vs retail,
   sentiment globale e schiuma ETF.
   ⚠ NON e' il ritorno del `quadrante` respinto in v226. Quello era un widget IDENTICO ripetuto
   su TRENTA indicatori — un muro indistinto — e con una scala nuda "sfavorevole → favorevole"
   senza riferimenti. Qui sono CINQUE strumenti scelti uno per uno, e l'arco porta le ZONE
   NOMINATE: la lancetta non indica un punto su una scala anonima, indica una zona che ha un nome
   scritto sotto. La differenza fra i due casi e' quella fra un cruscotto e un muro di quadranti
   uguali. Come per la scala, ogni tachimetro DICHIARA da dove vengono le sue bande. */
function tachimetro(v, opt = {}) {
  if (v == null || isNaN(v)) return "";
  const val = Math.max(0, Math.min(100, Math.round(v)));
  const zone = (opt.zone || []).filter(z => z && z.a > z.da);
  if (!zone.length) return "";
  /* ⚠ il numero stava a cy-24, DENTRO l'arco: e' esattamente dove passa la lancetta, e a meta'
     scala i due si sovrapponevano (misurato a colpo d'occhio su 53 e 55). L'arco e' aperto in
     basso, quindi sotto il perno c'e' spazio libero: il numero va li'. */
  const W = 300, H = 186, cx = W / 2, cy = 138, R = 112, sp = 22;
  const ang = (p) => Math.PI * (1 - p / 100);
  const P = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy - r * Math.sin(a)).toFixed(2)}`;
  const arco = zone.map(z => {
    const a0 = ang(z.da), a1 = ang(z.a);
    return `<path d="M ${P(R, a0)} A ${R} ${R} 0 ${(z.a - z.da) > 50 ? 1 : 0} 1 ${P(R, a1)}"
      fill="none" stroke="${z.colore}" stroke-width="${sp}" stroke-opacity=".8"
      ><title>${esc(z.nome)}: da ${z.da} a ${z.a}</title></path>`;
  }).join("");
  const tacche = [0, 25, 50, 75, 100].map(t => {
    const a = ang(t), i = P(R - sp / 2 - 2, a).split(" "), o = P(R + sp / 2 + 2, a).split(" ");
    return `<line x1="${i[0]}" y1="${i[1]}" x2="${o[0]}" y2="${o[1]}"
       stroke="var(--bg)" stroke-width="${t === 50 ? 2.4 : 1.4}" opacity="${t === 50 ? .95 : .6}"/>`;
  }).join("");
  const a = ang(val), punta = P(R - 16, a).split(" ");
  const dentro = zone.find(z => val >= z.da && val <= z.a);
  const col = dentro ? dentro.colore : scoreColor(val);
  return `<div class="tk"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.aria || "tachimetro")}: ${val} su 100">
      ${arco}${tacche}
      <line x1="${cx}" y1="${cy}" x2="${punta[0]}" y2="${punta[1]}" stroke="var(--text)" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="7" fill="var(--text)"/><circle cx="${cx}" cy="${cy}" r="3" fill="var(--card-2)"/>
      <text x="${cx}" y="${cy + 36}" text-anchor="middle" font-size="30" font-weight="700" font-family="var(--mono)" fill="${col}">${val}</text>
      <text x="12" y="${cy + 15}" font-size="9.5" fill="var(--muted)">0</text>
      <text x="${W - 12}" y="${cy + 15}" text-anchor="end" font-size="9.5" fill="var(--muted)">100</text>
    </svg>${dentro ? `<div class="tk-zona" style="color:${dentro.colore}">${esc(dentro.nome)}</div>` : ""}
    <div class="tk-fonte muted">${esc(opt.fonte || "bande di lettura convenzionali, non soglie calcolate dai dati")}</div></div>`;
}

/* ═══ v238 — OGNI INDICATORE HA LA SUA FORMA E LA SUA LETTURA ═══════════════════════════════
   Richiesta CEO: "voglio tutti grafici in struttura", con "dati dettagliati e spiegazioni di
   lettura del dato". Il registro assegna a ciascuno la forma che i suoi dati permettono
   davvero — misurata prima, non ipotizzata:
     · chi ha COMPONENTI (i compositi) → barre dei fattori, dal peggiore al migliore. E' cio' che
       mostrava la sezione "Da cosa nascono i punteggi", che infatti sparisce: il contenuto entra
       nella scheda del suo indicatore invece di vivere in un blocco separato che ripeteva i nomi.
     · chi ha una SERIE → la linea nel tempo (gia' gestita da serieIndicatore).
     · chi ha UN VALORE SOLO → la scala con le zone nominate. Il numero da solo non dice niente:
       "3,7%" diventa informazione quando l'asse mostra dov'e' il target della Fed.
     · le date → conto alla rovescia con le prossime scadenze.
   Ogni voce porta anche COME SI LEGGE: una riga che dice cosa guardare, non cosa fare (le
   istruzioni vivono nella testata del prompt, non qui — e questa e' UI, non payload). */
/* v243 — le bande dei punteggi 0-100 del sistema: una convenzione di LETTURA, dichiarata come
   tale. Non sono soglie calcolate: il punteggio e' gia' normalizzato dal motore, e queste bande
   servono solo a dare un nome alla zona in cui cade la lancetta. */
const ZONE_PUNTEGGIO = [
  { da: 0, a: 35, nome: "sfavorevole al libro", colore: "var(--red)" },
  { da: 35, a: 45, nome: "debole", colore: "var(--yellow)" },
  { da: 45, a: 55, nome: "neutro", colore: "var(--muted)" },
  { da: 55, a: 70, nome: "favorevole", colore: "var(--green)" },
  { da: 70, a: 100, nome: "molto favorevole", colore: "var(--green)" },
];
const punteggioDi = (k) => { try { return (indicatoriClassifica().find(x => x.k === k) || {}).score ?? null; } catch { return null; } };
/* aggiunge il tachimetro davanti a quello che la voce gia' mostrava, senza toglierle niente */
function conTachimetro(comp, base, aria) {
  if (!base) return null;
  const t = tachimetro((comp || {}).score, { aria,
    zone: ZONE_PUNTEGGIO, fonte: "bande di lettura convenzionali sul punteggio 0-100 del sistema" });
  return { g: t + base.g, n: base.n };
}

const FORMA_INDICATORE = {
  carry: (m) => {
    const c = m.carry; if (!c || c.spread == null) return null;
    const p = punteggioDi("carry");
    return { g: tachimetro(p, { aria: "carry USA-Giappone", zone: ZONE_PUNTEGGIO,
        fonte: "bande di lettura convenzionali sul punteggio 0-100 del sistema" })
        /* ⚠ la nota va PASSATA al filtro di ridondanza (v237), o le righe del pannello
           ripetono gli stessi numeri che scrivo due righe sotto — il difetto gia' corretto. */
        + contenutoDalPannello("carry", `${c.spread} ${c.usdjpy} ${c.usdjpy_chg_1m} ${c.boj_rate} ${c.us10} ${c.jp10}`),
      n: `Spread 10A USA−Giappone ${fmtNum.format(c.spread)} pp · USD/JPY ${fmtNum.format(c.usdjpy)} (${signTxt(c.usdjpy_chg_1m)} in un mese) · tasso BoJ ${c.boj_rate}%. <b>Come si legge:</b> più lo spread è ampio e più lo yen è debole, più conviene finanziarsi in yen per comprare asset in dollari — è il carry trade che ha alimentato il tech. Lo spread in compressione o uno yen che si rafforza forzano la chiusura di quelle posizioni, e le vendite partono dai titoli più affollati.` };
  },
  "mk:EURJPY=X": (m) => {
    const q = (m.markets || []).find(x => x.key === "EURJPY=X"); if (!q) return null;
    const v = parseFloat(String(q.value).replace(",", ".")); const c = m.carry || {};
    return { g: scala(v, { min: 150, max: 200, unita: "", aria: "EUR/JPY",
        /* ⚠ v240 — QUI AVEVO INVENTATO. La prima stesura segnava una "zona intervento" a 185 e
           chiamava 170-185 "fascia recente": nessuno dei due numeri esiste nel file, e la BoJ e'
           intervenuta storicamente su USD/JPY, non su EUR/JPY. Erano due affermazioni con
           l'autorita' di un dato e nessun dato dietro — la classe che v195 chiama "un ID
           indovinato scritto come se fosse certo". Restano bande di sola LETTURA, dichiarate
           come tali, e l'unico riferimento tracciato e' il tasso BoJ, che nel file c'e'. */
        zone: [{ da: 150, a: 170, nome: "yen relativamente forte", colore: "var(--green)" },
               { da: 170, a: 185, nome: "fascia intermedia", colore: "var(--muted)" },
               { da: 185, a: 200, nome: "yen molto debole", colore: "var(--red)" }],
        fonte: "bande di sola lettura: nel file non c'e' un intervallo storico di EUR/JPY" }),
      n: `Oggi ${q.value} (${signTxt(q.change_pct)} nella seduta).${c.boj_rate != null ? ` Tasso BoJ ${c.boj_rate}%.` : ""}
        <b>Come si legge:</b> più il numero sale, più lo yen è debole e più conviene finanziarsi in yen per comprare asset in dollari — è il carry trade che sostiene il tech. Uno yen che si rafforza di colpo costringe a chiudere quelle posizioni, e le chiusure partono dai titoli più affollati.` };
  },
  "in:umich": (m) => {
    const i = (m.indicators || []).find(x => x.key === "umich"); if (!i) return null;
    const v = parseFloat(String(i.value).replace(",", "."));
    return { g: scala(v, { min: 50, max: 110, unita: "", aria: "fiducia consumatori",
        zone: [{ da: 50, a: 70, nome: "pessimismo profondo", colore: "var(--red)" },
               { da: 70, a: 90, nome: "cautela", colore: "var(--yellow)" },
               { da: 90, a: 110, nome: "ottimismo", colore: "var(--green)" }],
        /* ⚠ v240 — tolta la tacca "media storica 85": quel numero NON e' nel file. Scriverlo
           sull'asse gli dava l'autorita' di un dato calcolato, che non aveva. */
        fonte: "bande di sola lettura: il file porta il valore corrente, non la serie storica" }),
      n: `${i.value} · rilevazione ${i.date}. <b>Come si legge:</b> misura quanto le famiglie si sentono sicure di spendere, e i consumi sono i due terzi del PIL americano. Sotto 70 è un livello da recessione; il dato arriva da FRED con 1-2 mesi di ritardo di licenza, quindi è più lento di quanto sembri.` };
  },
  dollar: (m) => {
    const d = m.dollar_ruler; if (!d || d.chg_3m_pct == null) return null;
    return { g: scala(d.chg_3m_pct, { min: -10, max: 10, unita: "%", aria: "dollaro 3 mesi",
        zone: [{ da: -10, a: -5, nome: "dollaro debole: aiuta gli utili esteri", colore: "var(--green)" },
               { da: -5, a: 5, nome: "impatto valutario neutro", colore: "var(--muted)" },
               { da: 5, a: 10, nome: "dollaro forte: comprime gli utili esteri", colore: "var(--red)" }],
        soglie: [{ v: 0, testo: "invariato" }],
        fonte: "la banda ±5% è la convenzione già usata dal sistema per l'impatto valutario" }),
      n: `DXY ${fmtNum.format(d.value)} · ${signTxt(d.chg_3m_pct)} in 3 mesi. <b>Come si legge:</b> conta la VARIAZIONE, non il livello. Le multinazionali americane fatturano molto all'estero: un dollaro che si rafforza di oltre il 5% in un trimestre taglia gli utili convertiti, uno che si indebolisce li gonfia. Dentro ±5% l'effetto è rumore.` };
  },
  "mk:EURUSD=X": (m) => {
    const q = (m.markets || []).find(x => x.key === "EURUSD=X"); if (!q) return null;
    const v = parseFloat(String(q.value).replace(",", "."));
    return { g: scala(v, { min: 1.0, max: 1.3, unita: "", aria: "EUR/USD", fmt: (x) => fmtNum.format(Math.round(x * 1000) / 1000),
        zone: [{ da: 1.0, a: 1.08, nome: "euro debole", colore: "var(--red)" },
               { da: 1.08, a: 1.18, nome: "fascia ordinaria", colore: "var(--muted)" },
               { da: 1.18, a: 1.3, nome: "euro forte", colore: "var(--green)" }],
        fonte: "bande di sola lettura: nel file c'è il cambio corrente, non il suo intervallo storico" }),
      n: `${q.value} (${signTxt(q.change_pct)} oggi). <b>Come si legge:</b> il libro è per la maggior parte in dollari e non coperto, quindi questo cambio muove il patrimonio in euro anche a prezzi fermi. Euro che sale = il tuo controvalore in euro scende, e viceversa: è il motivo per cui l'alpha in euro e quello in dollari possono avere segni diversi.` };
  },
  "in:gdp": (m) => {
    const i = (m.indicators || []).find(x => x.key === "gdp"); if (!i) return null;
    const v = parseFloat(String(i.value).replace(",", ".").replace("%", ""));
    const yoy = (m.yield_recession || {}).gdp_last;
    return { g: scala(v, { min: -2, max: 6, unita: "%", aria: "PIL",
        zone: [{ da: -2, a: 0, nome: "contrazione", colore: "var(--red)" },
               { da: 0, a: 2, nome: "crescita sotto il trend", colore: "var(--yellow)" },
               { da: 2, a: 6, nome: "crescita solida", colore: "var(--green)" }],
        soglie: [{ v: 2, testo: "trend" }],
        fonte: "la soglia del 2% è quella dichiarata dalla pipeline (crescita >2% positiva)" }),
      n: `${i.value} trimestrale annualizzato · rilevazione ${i.date}${yoy != null ? ` · ${signTxt(yoy)} anno su anno` : ""}. <b>Come si legge:</b> sotto il 2% l'economia cresce meno del proprio potenziale, e i multipli azionari fanno più fatica a essere giustificati dagli utili. È il dato più lento del quadro: trimestrale e rivisto due volte.` };
  },
  "in:cpi": (m) => {
    const c = (m.indicators || []).find(x => x.key === "cpi"); if (!c) return null;
    const p = (m.indicators || []).find(x => x.key === "pce");
    const v = parseFloat(String(c.value).replace(",", ".").replace("%", ""));
    return { g: scala(v, { min: 0, max: 8, unita: "%", aria: "inflazione",
        zone: [{ da: 0, a: 2, nome: "sotto il target", colore: "var(--green)" },
               { da: 2, a: 3.5, nome: "sopra il target ma gestibile", colore: "var(--yellow)" },
               { da: 3.5, a: 8, nome: "inflazione che tiene alti i tassi", colore: "var(--red)" }],
        soglie: [{ v: 2, testo: "target Fed" }],
        fonte: "il 2% è il target dichiarato della Federal Reserve" }),
      n: `CPI ${c.value}${p ? ` · PCE ${p.value}` : ""} · rilevazione ${c.date}. <b>Come si legge:</b> due misure della stessa cosa, e la Fed guarda il PCE. Finché resta sopra il 2% la Fed non ha motivo di tagliare, e senza tagli i multipli del growth restano sotto pressione: è il canale per cui questo numero arriva al tuo portafoglio.` };
  },
  /* v252 — la forma a barre del ciclo economico non serve più: la scheda è uscita dalla
     classifica perché i suoi componenti hanno già le proprie. */
  risk_sentiment: (m) => conTachimetro(m.risk_sentiment, barreComposito(m.risk_sentiment, "Sentiment globale",
    "I fattori risk-on / risk-off che compongono il sentiment, dal peggiore al migliore. <b>Come si legge:</b> quando i fattori sono tutti d'accordo il sentiment è un segnale; quando sono in disaccordo il punteggio medio nasconde più di quanto mostri — e il disaccordo si vede dalla dispersione delle barre."), "sentiment globale"),
  smart_money: (m) => conTachimetro(m.smart_money, barreComposito(m.smart_money, "Istituzionali vs retail",
    "I quattro segnali che distinguono il denaro istituzionale da quello retail. <b>Come si legge:</b> struttura di mercato, term structure del VIX, spread di credito e put/call. Quando divergono dal comportamento del retail, storicamente conta di più quello che fanno gli istituzionali."), "istituzionali vs retail"),
  fear_greed: (m) => {
    const f = m.fear_greed; if (!f || !(f.components || []).length) return null;
    const b = barreComposito(f, "Fear & Greed", "");
    if (!b) return null;
    /* le bande del Fear & Greed sono quelle pubblicate da CNN (0-25 paura estrema, 25-45 paura,
       45-55 neutro, 55-75 avidita', 75-100 avidita' estrema): sono una convenzione DELL'INDICE,
       non una mia scelta, e si puo' dire da dove viene. */
    const tach = tachimetro(f.score, { aria: "Fear & Greed",
      zone: [{ da: 0, a: 25, nome: "paura estrema", colore: "var(--red)" },
             { da: 25, a: 45, nome: "paura", colore: "var(--yellow)" },
             { da: 45, a: 55, nome: "neutro", colore: "var(--muted)" },
             { da: 55, a: 75, nome: "avidità", colore: "var(--green)" },
             { da: 75, a: 100, nome: "avidità estrema", colore: "var(--green)" }],
      fonte: "le cinque bande sono quelle pubblicate da CNN per questo indice" });
    const st = [f.week_ago, f.month_ago, f.year_ago].filter(x => x != null);
    return { g: tach + b.g, n: `${st.length ? `Una settimana fa ${f.week_ago} · un mese fa ${f.month_ago} · un anno fa ${f.year_ago}. ` : ""}Sette componenti, dal peggiore al migliore. <b>Come si legge:</b> è un contrarian: la paura estrema è storicamente un momento di acquisto e l'avidità estrema un momento di cautela. Il livello di oggi conta meno della DIREZIONE rispetto alle rilevazioni passate.` };
  },
  _alpha: (m) => {
    const b = m.benchmarks || {}; if (b.ndx == null) return null;
    return { g: scala(b.ndx, { min: -4, max: 4, unita: " pp", aria: "scarto vs indice",
        zone: [{ da: -4, a: -0.5, nome: "sotto l'indice", colore: "var(--red)" },
               { da: -0.5, a: 0.5, nome: "in linea", colore: "var(--muted)" },
               { da: 0.5, a: 4, nome: "sopra l'indice", colore: "var(--green)" }],
        soglie: [{ v: 0, testo: "pari" }],
        fonte: "lo zero è il pareggio con l'indice; le bande sono di sola lettura" }),
      n: `Il Nasdaq 100 ha fatto ${signTxt(b.ndx)} nella seduta${b.sp500 != null ? `, l'S&P ${signTxt(b.sp500)}` : ""}${b.sox != null ? `, i semiconduttori ${signTxt(b.sox)}` : ""}. <b>Come si legge:</b> è lo scarto di UNA seduta, quindi rumore quasi sempre: serve a vedere se il libro si è mosso col mercato o contro. Il giudizio sul processo sta nell'alpha di periodo, non qui.` };
  },
  witching: (m) => {
    const w = m.witching; if (!w || w.days == null) return null;
    return { g: contoAllaRovescia(w.days, w.upcoming, {}),
      n: `Prossima quadrupla scadenza il ${dataBreve(w.next)}. <b>Come si legge:</b> nel giorno delle scadenze tecniche scadono insieme opzioni e futures su indici e singole azioni, e i volumi esplodono per ragioni che non hanno a che fare coi fondamentali. Sotto i 30 giorni conviene evitare di leggere i movimenti come segnale, e non piazzare ordini limite stretti in quella seduta.` };
  },
  "mk:^TNX": (m) => {
    const q = (m.markets || []).find(x => x.key === "^TNX"); if (!q) return null;
    const v = parseFloat(String(q.value).replace(",", ".").replace("%", ""));
    return { g: scala(v, { min: 2, max: 6, unita: "%", aria: "Treasury 10 anni",
        zone: [{ da: 2, a: 3.5, nome: "tassi che sostengono i multipli", colore: "var(--green)" },
               { da: 3.5, a: 4.5, nome: "fascia neutra", colore: "var(--muted)" },
               { da: 4.5, a: 6, nome: "tassi che comprimono i multipli", colore: "var(--red)" }],
        soglie: [{ v: 4, testo: "4%" }],
        fonte: "la soglia del 4% è quella già usata dal sistema (sopra comprime i multipli)" }),
      n: `${q.value} (${signTxt(q.change_pct)} pp nella seduta). <b>Come si legge:</b> è il tasso privo di rischio con cui si scontano gli utili futuri. Più sale, meno vale oggi un utile lontano nel tempo — ed è per questo che colpisce il growth più del value: i suoi utili stanno più avanti.` };
  },
  momentum: (m) => {
    const s = (m.momentum || {}).sp500; if (!s || s.dist_pct == null) return null;
    const n2 = (m.momentum || {}).ndx;
    return { g: scala(s.dist_pct, { min: -15, max: 15, unita: "%", aria: "distanza dalla media 125",
        zone: [{ da: -15, a: -3, nome: "sotto la media: trend primario deteriorato", colore: "var(--red)" },
               { da: -3, a: 3, nome: "sulla media", colore: "var(--muted)" },
               { da: 3, a: 15, nome: "sopra la media: trend primario integro", colore: "var(--green)" }],
        soglie: [{ v: 0, testo: "media 125" }],
        fonte: "lo zero è la media a 125 sedute calcolata dalla pipeline" }),
      n: `S&P 500 a ${fmtNum.format(s.price)} contro una media a 125 sedute di ${fmtNum.format(s.sma125)}${n2 ? ` · Nasdaq 100 ${signTxt(n2.dist_pct)}` : ""}. <b>Come si legge:</b> 125 sedute sono circa sei mesi: è la linea che separa un ribasso dentro un rialzo da un cambio di regime. Finché il prezzo sta sopra, le discese sono correzioni; sotto, vanno trattate diversamente.` };
  },
  liquidity: (m) => {
    const l = m.liquidity_split; if (!l || l.retail_pctile_5y == null) return null;
    return { g: scala(l.retail_pctile_5y, { min: 0, max: 100, unita: "° pct", aria: "liquidità retail",
        zone: [{ da: 0, a: 40, nome: "poca benzina a bordo campo", colore: "var(--yellow)" },
               { da: 40, a: 75, nome: "liquidità nella norma", colore: "var(--muted)" },
               { da: 75, a: 100, nome: "molta liquidità ferma", colore: "var(--green)" }],
        soglie: [{ v: 50, testo: "mediana 5A" }],
        fonte: "il percentile e la sua mediana vengono dal dato (5 anni di fondi monetari)" }),
      n: `Fondi monetari retail ${fmtNum.format(l.retail_mmf_bln)} mld (${signTxt(l.retail_yoy_pct)} in un anno, ${l.retail_pctile_5y}° percentile su 5 anni) · istituzionali ${l.inst_cash_pct}% in liquidità. <b>Come si legge:</b> ha due letture opposte e vanno tenute insieme. Molta liquidità ferma è benzina potenziale per i rialzi; ma se sta AUMENTANDO significa che qualcuno sta uscendo dal rischio adesso. Guarda il livello e la direzione, non uno solo dei due. Sono proxy dichiarati, non i flussi veri.` };
  },
  breadth: (m) => {
    const b = m.breadth; if (!b || b.divergence_pp == null) return null;
    return { g: barreOrdinate([
        { nome: "SPY — le grandi", valore: b.spy_1m_pct, colore: "var(--blue)", testo: `${signTxt(b.spy_1m_pct)} a 1 mese` },
        { nome: "RSP — tutte uguali", valore: b.rsp_1m_pct, colore: "var(--purple)", testo: `${signTxt(b.rsp_1m_pct)} a 1 mese` },
      ], {}),
      n: `Scarto ${signTxt(b.divergence_pp)} pp. <b>Come si legge:</b> SPY pesa le società per capitalizzazione, RSP le tratta tutte uguali. Se SPY sale molto più di RSP il rialzo lo fanno poche mega-cap e la partecipazione è stretta — il tipo di rialzo che si rompe in fretta. Se salgono insieme, il movimento è largo e più solido. Allarme sopra i 4 pp di scarto: oggi ${Math.abs(b.divergence_pp) > 4 ? "è attivo" : "non è attivo"}.` };
  },
  sp500_pe: (m) => {
    const p2 = m.sp500_pe, f = m.forward_pe; if (!p2 || p2.current == null) return null;
    return { g: scala(p2.current, { min: 10, max: 40, unita: "×", aria: "P/E S&P 500",
        zone: [{ da: 10, a: 18, nome: "valutazione contenuta", colore: "var(--green)" },
               /* ⚠ v240 — si chiamava "sopra la media storica": anche il NOME di una zona e'
                  un'affermazione, e quella media nel file non c'e' (sp500_pe.avg_10y e' null).
                  Il nome ora descrive il livello senza rivendicare un confronto che non ho. */
               { da: 18, a: 25, nome: "valutazione piena", colore: "var(--yellow)" },
               { da: 25, a: 40, nome: "valutazione tesa", colore: "var(--red)" }],
        /* ⚠ v240 — la tacca "media storica 16,5" era la media del FORWARD (forward_pe.avg_hist)
           disegnata su una scala del TRAILING: due metodologie diverse confrontate come se
           fossero la stessa, che e' proprio cio' che il payload avverte di non fare. E
           sp500_pe.avg_10y nel file e' null, quindi una media storica del trailing NON esiste:
           non si disegna. Il forward e il suo riferimento restano scritti nella nota. */
        fonte: "bande di sola lettura: nel file non c'e' una media storica del P/E trailing" }),
      n: `Trailing ${fmtNum.format(p2.current)}×${p2.nasdaq_pe ? ` · Nasdaq 100 ${fmtNum.format(p2.nasdaq_pe)}×` : ""}${f && f.value != null ? ` · forward ${fmtNum.format(f.value)}×` : ""}. <b>Come si legge:</b> il trailing guarda gli utili già fatti, il forward quelli attesi — e la differenza fra i due dice quanta crescita il mercato sta già prezzando. Un multiplo alto non è di per sé un segnale di vendita: diventa fragile quando i tassi salgono, perché è proprio il multiplo a comprimersi per primo.` };
  },
  "in:unemp": (m) => {
    const u = (m.indicators || []).find(x => x.key === "unemp"); if (!u) return null;
    const v = parseFloat(String(u.value).replace(",", ".").replace("%", ""));
    const n2 = (m.indicators || []).find(x => x.key === "nfp");
    return { g: scala(v, { min: 3, max: 8, unita: "%", aria: "disoccupazione",
        zone: [{ da: 3, a: 4.5, nome: "piena occupazione", colore: "var(--green)" },
               { da: 4.5, a: 5.5, nome: "mercato in raffreddamento", colore: "var(--yellow)" },
               { da: 5.5, a: 8, nome: "recessione del lavoro", colore: "var(--red)" }],
        /* ⚠ v240 — TOLTA la tacca "soglia Sahm" a 4,5%: la regola di Sahm NON e' un livello, e'
           un MOVIMENTO (media a 3 mesi che sale di 0,5 pp sopra il minimo dei 12). Segnarla come
           livello era falso, e contraddiceva la spiegazione scritta due righe sotto nella stessa
           scheda — che invece la enuncia correttamente. Il file non ha la media a 3 mesi, quindi
           la regola non e' calcolabile qui e non si finge che lo sia. */
        fonte: "bande di sola lettura: la regola di Sahm guarda la SALITA, non il livello, e il file non ha la media a 3 mesi" }),
      n: `Disoccupazione ${u.value}${n2 ? ` · nuovi posti ${n2.value}` : ""} · rilevazione ${u.date}. <b>Come si legge:</b> conta la DIREZIONE più del livello. La regola di Sahm dice che quando la media a 3 mesi sale di mezzo punto sopra il minimo dell'anno la recessione è già cominciata — il livello assoluto è ancora basso quando il segnale scatta, ed è per questo che si guarda la salita, non il valore.` };
  },
  froth: (m) => {
    const f = m.froth; if (!f || !f.soxl) return null;
    const righe = [["SOXL — semi 3×", f.soxl], ["TQQQ — Nasdaq 3×", f.tqqq]].filter(([, x]) => x && x.rvol != null)
      .map(([nome, x]) => ({ nome, valore: x.rvol, colore: x.rvol >= 2.5 ? "var(--red)" : x.rvol >= 1.5 ? "var(--yellow)" : "var(--green)",
                             testo: `RVol ${fmtNum.format(x.rvol)}× · ${signTxt(x.chg_5d_pct)} in 5 sedute` }));
    if (!righe.length) return null;
    return { g: tachimetro(punteggioDi("froth"), { aria: "schiuma speculativa", zone: ZONE_PUNTEGGIO,
        fonte: "bande di lettura convenzionali sul punteggio 0-100 del sistema" }) + barreOrdinate(righe, {}),
      n: `<b>Come si legge:</b> sono ETF a leva tripla, comprati quasi solo dal retail per scommettere in fretta. Volumi molto sopra la media MENTRE il prezzo sale sono euforia speculativa, che storicamente precede le correzioni; volumi alti mentre il prezzo scende sono invece capitolazione, che è l'opposto. L'allarme scatta sopra 2,5× con prezzo in salita: oggi ${f.alert ? "è attivo" : "non è attivo"}.` };
  },
};
/* le barre dei fattori di un composito: e' cio' che mostrava "Da cosa nascono i punteggi", ora
   dentro la scheda del suo indicatore invece che in un blocco separato che ne ripeteva i nomi */
function barreComposito(c, nome, comeSiLegge) {
  const comp = ((c || {}).components || []).filter(x => x && x.score != null);
  if (comp.length < 2) return null;
  const righe = [...comp].sort((a, b) => a.score - b.score)
    .map(x => ({ nome: x.label, valore: Math.round(x.score) - 50, colore: scoreColor(x.score), testo: `${Math.round(x.score)}/100` }));
  const peggio = righe[0], meglio = righe[righe.length - 1];
  return { g: barreOrdinate(righe, {}),
    n: `${comeSiLegge}${comeSiLegge ? " " : ""}Oggi tira giù <b>${esc(peggio.nome)}</b> (${peggio.testo}) e tiene su <b>${esc(meglio.nome)}</b> (${meglio.testo}).` };
}

/* ═══ v235 — IMPACCAMENTO A MASONRY DELLA GRIGLIA ══════════════════════════════════════════
   Richiesta CEO: "ottimizza la distribuzione di ogni singolo oggetto in struttura".
   Il problema misurato: le schede hanno altezze molto diverse (una col grafico e nove righe di
   dati sta a ~360px, una col solo punteggio a ~90px) e una griglia CSS allinea per RIGHE — la
   riga e' alta quanto la scheda piu' alta, e sotto le altre resta un buco. Su 30 schede il
   vuoto e' piu' della meta' dello schermo.
   `columns` CSS impaccherebbe da solo, ma legge in COLONNE — dall'alto in basso e poi a capo —
   e questa griglia e' ORDINATA dal peggiore al migliore: leggerla per colonne cambierebbe il
   significato dell'ordine. Qui si tiene la griglia (ordine sinistra→destra intatto) e si dice a
   ogni scheda quante righe da 8px occupare: le successive risalgono a riempire il vuoto.
   ⚠ Va rieseguito quando cambia la larghezza: il numero di colonne cambia e con esso l'altezza
   delle schede (il testo va a capo diversamente). */
function impaccaGriglia(box) {
  if (!box || typeof getComputedStyle !== "function") return;   // harness senza layout: no-op
  box.querySelectorAll?.(".mg-tris").forEach(g => {
    let cs;
    try { cs = getComputedStyle(g); } catch { return; }
    if (cs.display !== "grid") return;
    const passo = 8, gap = parseFloat(cs.rowGap) || 14;
    g.style.gridAutoRows = passo + "px";
    g.style.alignItems = "start";
    g.querySelectorAll(":scope > .mg-card").forEach(c => {
      c.style.gridRowEnd = "";                                  // si riparte dall'altezza vera
      const h = c.getBoundingClientRect?.().height || 0;
      if (h > 0) c.style.gridRowEnd = `span ${Math.ceil((h + gap) / (passo + gap))}`;
    });
  });
}
/* una sola registrazione, in delega: al ridimensionamento le colonne cambiano e le altezze con
   loro. Senza questo l'impaccamento resterebbe quello della prima misura (difetto della stessa
   famiglia del viewBox non-costante: una misura presa una volta e usata per sempre). */
let _impaccaTimer = null;
function registraImpaccamento() {
  if (registraImpaccamento._fatto) return;
  registraImpaccamento._fatto = true;
  window.addEventListener?.("resize", () => {
    clearTimeout(_impaccaTimer);
    _impaccaTimer = setTimeout(() => impaccaGriglia(document.querySelector(".shell-main")), 120);
  });
}

function renderIndicatori() {
  const box = $("#mg-tutti"); if (!box) return;
  const nota = $("#mg-tutti-note");
  const righe = indicatoriClassifica();
  if (righe.length < 3) { box.innerHTML = '<div class="muted">Indicatori non disponibili.</div>'; return; }
  const conPan = new Set(Object.keys(MACRO_INFO || {}));

  /* v233 — MINI TAB, la forma originaria. Ogni indicatore e' una scheda: nome, punteggio, nota.
     Dove ha una SERIE STORICA vera si disegna la linea nel tempo con le sue soglie (la forma dei
     termometri di stress); dove il POPUP portava un grafico o una tabella, quelli vengono qui
     dentro; dove non c'e' ne' l'una ne' l'altra la scheda resta il numero e la sua nota, senza
     riempitivi. Il clic continua ad aprire il pannello completo. */
  box.innerHTML = `<div class="mg-tris">${righe.map(r => {
    /* ⚠ v235 — il grafico della serie NON esclude le righe di dati del pannello: sono due cose
       diverse (la storia e il valore corrente con la sua data e il suo impatto), e prima chi
       aveva una serie perdeva le seconde. Ora la scheda porta entrambe. */
    /* v238 — l'ordine di precedenza: prima la forma DEDICATA del registro (che porta anche la
       spiegazione di lettura), poi la serie storica, poi il contenuto del pannello. */
    const forma = (() => { try { return FORMA_INDICATORE[r.k]?.(DATA.macro || {}) || null; } catch { return null; } })();
    const se = forma ? null : serieIndicatore(r.k);
    const dal = forma ? "" : contenutoDalPannello(conPan.has(r.k) ? r.k : null, r.sub || "");
    const linea = se
      ? (se.doppia
          ? graficoSerie(se.doppia, { h: 104, compatto: true, soglie: se.soglie, etichetteDx: false, aria: r.nome })
          : graficoSerie([{ nome: r.nome, punti: se.punti, colore: scoreColor(r.score) }],
              { h: 104, compatto: true, soglie: se.soglie, unita: se.unita, assex: se.assex,
                fmtY: se.fmtY, etichetteDx: false, aria: r.nome }))
      : "";
    const g = forma ? forma.g : linea + (se ? dal.replace(/<svg[\s\S]*?<\/svg>/g, "") : dal);
    return tessera({ t: r.nome, v: `${r.score}<span class="muted" style="font-size:12px">/100</span>`,
      cls: clsScore(r.score), grafico: g,
      /* v250 — sotto ogni card macro, la riga di cadenza: rilevazione, età, prossimo atteso.
         Sta in FONDO e in piccolo: è contesto sul dato, non il dato. */
      n: (forma ? forma.n : esc(r.sub || "")) + (r.cadenza ? `<div class="mg-cad muted">${esc(r.cadenza)}</div>` : ""),
      tk: conPan.has(r.k) ? r.k : null, id: r.k });
  }).join("")}</div>`;
  agganciaTessere(box);
  /* v241 — l'ordine scelto dal CEO si riapplica a OGNI render (la griglia si ricostruisce da
     capo ogni volta), e i comandi di trascinamento si rimontano sulle schede nuove. */
  const griglia = box.querySelector(".mg-tris");
  applicaOrdineSchede(griglia, "indicatori");
  montaTrascinamentoSchede(griglia, "indicatori");

  /* v238 — le quattro tessere di testata (media, quanti sotto 40, i tre peggiori, quelli che
     tengono) sono state rimosse su richiesta del CEO: erano un riassunto della griglia che sta
     appena sotto, cioe' gli stessi fatti detti due volte. */
  if (nota) nota.innerHTML = `Una scheda per indicatore, tutte sulla stessa scala: <b>100 = favorevole al libro, 0 = sfavorevole</b>, ordinate dalla peggiore.
    Dove esiste una storia il grafico la mostra; dove il pannello di dettaglio portava un grafico o una tabella, quelli sono <b>qui dentro</b> invece che dietro un clic.
    <b>Clicca una scheda</b> per il resto del pannello e le news di quell'indicatore.`;
}

/* v215 — CROSSHAIR sui grafici a linee. Un grafico statico costringe a stimare a occhio il
   valore di un punto; qui il valore lo dichiara. Funziona su qualunque svg.g-serie senza che
   il chiamante debba saperlo: si aggancia una volta sola, in delega sul documento. */
function attivaHoverGrafici() {
  if (attivaHoverGrafici._fatto) return;
  attivaHoverGrafici._fatto = true;
  const via = (svg) => { svg.querySelectorAll(".gs-hover").forEach(e => e.remove()); };
  const muovi = (svg, ev) => {
    let dati, geo;
    try { dati = JSON.parse(svg.dataset.hover || "[]"); geo = (svg.dataset.geo || "").split(",").map(Number); } catch { return; }
    if (!dati.length || geo.length !== 4) return;
    const box = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const xUser = (ev.clientX - box.left) / box.width * vb.width;
    const [L, R, T, B] = geo;
    if (xUser < L - 4 || xUser > R + 4) { via(svg); return; }
    via(svg);
    const ns = "http://www.w3.org/2000/svg";
    const mk = (t, attrs) => { const e = document.createElementNS(ns, t); for (const k in attrs) e.setAttribute(k, attrs[k]); e.classList.add("gs-hover"); return e; };
    let vicino = null;
    const etichette = [];
    dati.forEach(serie => {
      let best = null;
      serie.p.forEach(q => { const d = Math.abs(q.x - xUser); if (!best || d < best.d) best = { d, q }; });
      if (!best) return;
      if (!vicino || best.d < vicino.d) vicino = best;
      svg.appendChild(mk("circle", { cx: best.q.x, cy: best.q.y, r: 4, fill: serie.c, stroke: "var(--card)", "stroke-width": 1.5 }));
      etichette.push({ y: best.q.y, testo: `${fmtNum.format(best.q.v)}`, col: serie.c, nome: serie.n, d: best.q.d });
    });
    if (!vicino) return;
    svg.insertBefore(mk("line", { x1: vicino.q.x, y1: T, x2: vicino.q.x, y2: B, stroke: "var(--muted)", "stroke-width": 1, "stroke-dasharray": "3 3", opacity: .8 }), svg.firstChild);
    const destra = vicino.q.x > (L + R) / 2;
    etichette.forEach((e, i) => {
      const tx = mk("text", { x: destra ? vicino.q.x - 8 : vicino.q.x + 8, y: T + 12 + i * 13,
        "text-anchor": destra ? "end" : "start", "font-size": 11, "font-weight": 700,
        fill: e.col, "font-family": "var(--mono)" });
      tx.textContent = e.testo;
      svg.appendChild(tx);
    });
    const dLab = etichette[0] && etichette[0].d;
    if (dLab) {
      const t2 = mk("text", { x: destra ? vicino.q.x - 8 : vicino.q.x + 8, y: T + 12 + etichette.length * 13,
        "text-anchor": destra ? "end" : "start", "font-size": 9.5, fill: "var(--muted)" });
      t2.textContent = dataBreve(dLab, true);
      svg.appendChild(t2);
    }
  };
  document.addEventListener("pointermove", (ev) => {
    const svg = ev.target.closest ? ev.target.closest("svg.g-serie") : null;
    document.querySelectorAll("svg.g-serie").forEach(o => { if (o !== svg) via(o); });
    if (svg) muovi(svg, ev);
  }, { passive: true });
  document.addEventListener("pointerleave", () => document.querySelectorAll("svg.g-serie").forEach(via), true);
}

/* ═══ v216 — RILEVATORE DI PAGINA VECCHIA ═════════════════════════════════════════════════
   Il CEO ha visto una release "non comparire" più volte, e la causa non era il deploy: è che
   GitHub Pages serve index.html con `cache-control: max-age=600`. Per dieci minuti il browser
   non lo richiede — e siccome il cache-busting `?v=NNN` vive DENTRO index.html, finché quel
   file è vecchio il browser continua a chiedere le versioni vecchie di app.js e style.css.
   Il `<meta http-equiv="Cache-Control">` non protegge da questo: i browser lo ignorano.

   Qui si chiede al server la versione ATTUALE (fetch no-store, che salta la cache) e la si
   confronta con quella in esecuzione. Se non coincidono, la pagina lo dichiara invece di
   mostrare in silenzio contenuti vecchi — e la ricarica va su una URL che la cache non ha mai
   visto, perché un semplice reload ripescherebbe lo stesso index.html cachato. */
async function controllaVersione() {
  try {
    const r = await fetch(`index.html?nocache=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const m = (await r.text()).match(/app\.js\?v=(\d+)/);
    if (!m) return;
    const attesa = m[1];
    if (attesa === BUILD_VERSION) return;
    const box = $("#version-alert");
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `<div class="ver-alert">
      <div><b>Stai vedendo una versione vecchia della pagina.</b>
        In esecuzione <b>v${esc(BUILD_VERSION)}</b>, pubblicata <b>v${esc(attesa)}</b>.
        <span class="muted">Non è il sito: è la cache del browser (GitHub Pages tiene index.html per 10 minuti).</span></div>
      <button class="btn btn-primary btn-sm" id="ver-reload">Ricarica la versione ${esc(attesa)}</button>
    </div>`;
    $("#ver-reload")?.addEventListener("click", () => {
      // URL mai vista dalla cache: un reload normale ripescherebbe lo stesso file
      location.replace(location.pathname + "?r=" + Date.now());
    });
  } catch { /* offline o file:// — nessun avviso, meglio del falso allarme */ }
}

/* ═══ v219 — CIAMBELLA riusabile ══════════════════════════════════════════════════════════
   Una torta si legge senza istruzioni, ma vale SOLO per quantità che sono parti di un tutto
   e non negative. Qui ci finiscono la quota di varianza (somma 100%), l'allocazione (somma
   100%) e i campanelli accesi/spenti. NON ci finiscono i rendimenti di settore (hanno il
   segno) né i punteggi 0-100 (non si sommano a niente): farne una torta darebbe una figura
   che sembra dire qualcosa e non dice nulla.
   voci: [{nome, val, colore}] · opt.centro = {sopra, grande, sotto} */
function ciambella(voci, opt = {}) {
  const v = (voci || []).filter(x => x && x.val > 0);
  if (v.length < 2) return '<div class="muted">Dati insufficienti per la ripartizione.</div>';
  const tot = v.reduce((s, x) => s + x.val, 0);
  const R = 86, r = 54, C = 100, GIRO = 2 * Math.PI;
  let acc = -Math.PI / 2;
  const archi = v.map((x, i) => {
    const ang = x.val / tot * GIRO, fine = acc + ang;
    const grande = ang > Math.PI ? 1 : 0;
    const P = (raggio, a) => `${(C + raggio * Math.cos(a)).toFixed(2)},${(C + raggio * Math.sin(a)).toFixed(2)}`;
    const d = `M ${P(R, acc)} A ${R} ${R} 0 ${grande} 1 ${P(R, fine)} L ${P(r, fine)} A ${r} ${r} 0 ${grande} 0 ${P(r, acc)} Z`;
    acc = fine;
    const col = x.colore || ALLOC_COLORS[i % ALLOC_COLORS.length];
    const pct = Math.round(x.val / tot * 1000) / 10;
    return `<path d="${d}" fill="${col}" class="ciam-arco" data-ciam="${esc(x.nome)}"
      data-pct="${pct}" data-val="${x.val}"><title>${esc(x.nome)}: ${fmt1.format(pct)}%</title></path>`;
  }).join("");
  const c = opt.centro || {};
  return `<div class="ciam-wrap">
    <svg viewBox="0 0 200 200" class="ciam-svg" role="img" aria-label="${esc(opt.aria || "ripartizione")}">
      ${archi}
      ${c.sopra ? `<text x="100" y="90" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(c.sopra)}</text>` : ""}
      ${c.grande ? `<text x="100" y="108" text-anchor="middle" font-size="19" font-weight="700" fill="var(--text)" font-family="var(--mono)">${esc(c.grande)}</text>` : ""}
      ${c.sotto ? `<text x="100" y="124" text-anchor="middle" font-size="9.5" fill="var(--muted)">${esc(c.sotto)}</text>` : ""}
    </svg>
    <ul class="ciam-leg">${v.map((x, i) => {
      const pct = Math.round(x.val / tot * 1000) / 10;
      return `<li${x.tk ? ` data-ciam-tk="${esc(x.tk)}"` : ""}>
        <span class="ciam-dot" style="background:${x.colore || ALLOC_COLORS[i % ALLOC_COLORS.length]}"></span>
        <span class="ciam-nome">${esc(x.nome)}</span>
        <b class="ciam-pct">${fmt1.format(pct)}%</b>
        ${x.extra ? `<span class="muted ciam-extra">${x.extra}</span>` : ""}</li>`;
    }).join("")}</ul>
  </div>`;
}

/* ═══ v223 — LA TESSERA: un solo formato per tutto ════════════════════════════════════════
   Il CEO ha indicato "Termometri di stress" come l'unico blocco che legge senza sforzo, e ha
   chiesto che TUTTI i grafici abbiano quella struttura, con una regola precisa: "ogni barra
   deve essere un grafico, non devi accorpare tutto". Quindi le liste ordinate (35 indicatori,
   39 fattori, le categorie dei campanelli) si sciolgono in tessere: titolo, valore grande, un
   misuratore che mostra DOVE sta quel valore sulla sua scala, una riga di senso. */
/* v225 — `misuratore()` RIMOSSA. Era la barra 0-100 orizzontale: l'ultima forma che il CEO ha
   respinto ("vedo ancora tante barre, voglio i grafici"). Sostituita ovunque da `quadrante()`,
   un arco con lancetta — la posizione dell'ago si legge senza decodificare una scala.
   RICEVUTA DEL TAGLIO, scritta PRIMA di tagliare (regola v201-v204): 2 chiamanti, entrambi
   convertiti (renderScomposizione, renderSignposts); 0 riferimenti nei test; dentro i confini
   del blocco rimosso non vive nessun'altra funzione — il vicino a valle, tessera(), e' intatto. */
function tessera({ t, v, cls, grafico, n, tk, id }) {
  /* v241 — `id` e' la CHIAVE STABILE della scheda per il riordino: la chiave dell'indicatore
     (in:cpi, dollar, macroquant…), non il titolo e non la posizione. Una scheda rinominata non
     perde il posto che il CEO le ha dato, e una nuova finisce in coda invece di spostare tutto. */
  return `<div class="mg-card${tk ? " mg-click" : ""}"${id ? ` data-scheda="${esc(id)}"` : ""}${tk ? ` data-tess-tk="${esc(tk)}" role="button" tabindex="0"` : ""}>
    <div class="mg-card-head"><span class="mg-t">${esc(t)}</span><span class="mg-v ${cls || ""}">${v}</span></div>
    ${grafico || ""}${n ? `<div class="muted mg-n">${n}</div>` : ""}</div>`;
}
function agganciaTessere(box) {
  box.querySelectorAll("[data-tess-tk]").forEach(e => {
    const apri = () => openMacroInfo(e.dataset.tessTk);
    e.addEventListener("click", apri);
    e.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); apri(); } });
  });
}
const clsScore = (v) => v < 40 ? "neg" : v < 55 ? "warn" : "pos";

/* ═══ v224 — LA SERIE DIETRO OGNI INDICATORE ══════════════════════════════════════════════
   Il CEO vuole che ogni tessera abbia un grafico come la Curva 10A-2A: una linea nel tempo con
   la sua soglia. Ma un grafico nel tempo ha bisogno di punti nel tempo, e il file ne ha solo
   per una parte degli indicatori. Qui si disegna la linea SOLO dove la serie esiste davvero;
   dove non esiste resta il misuratore e la tessera lo DICHIARA, invece di far finta con una
   riga piatta a un punto. Per gli altri la pipeline ha cominciato ad accumulare (v224):
   fra qualche settimana avranno anche loro la loro linea, e comparira' da sola. */
function serieIndicatore(k) {
  const m = DATA?.macro || {};
  const perc = (h, lo, hi) => (h || []).map(x => ({ d: x.d, v: x.v }));
  switch (k) {
    case "in:curve": case "yield_recession":
      return (m.curve_history || []).length > 2
        ? { punti: m.curve_history, soglie: [{ v: 0, testo: "inversione", colore: "var(--red)" }], unita: "" } : null;
    case "credit": case "systemic_risk":
      return (m.credit?.history || []).length > 2
        ? { punti: m.credit.history, soglie: [{ v: 4, testo: "tensione", colore: "var(--yellow)" }], unita: "%" } : null;
    case "vix":
      return (m.vix?.spark || []).length > 2
        ? { punti: m.vix.spark.map(v => ({ d: null, v })), soglie: [{ v: 20, testo: "tensione", colore: "var(--yellow)" }],
            assex: ["30 sedute fa", "oggi"] } : null;
    case "margin_debt":
      return (m.margin_debt?.history || []).length > 2
        ? { punti: m.margin_debt.history.map(v => ({ d: null, v })), assex: ["13 mesi fa", "oggi"],
            fmtY: v => fmtNum.format(Math.round(v / 1000)) + " mld" } : null;
    case "fear_greed": {
      const f = m.fear_greed || {}; const p = [];
      if (f.year_ago != null) p.push({ d: null, v: f.year_ago });
      if (f.month_ago != null) p.push({ d: null, v: f.month_ago });
      if (f.week_ago != null) p.push({ d: null, v: f.week_ago });
      if (f.score != null) p.push({ d: null, v: f.score });
      return p.length > 2 ? { punti: p, soglie: [{ v: 50, testo: "neutro", colore: "var(--muted)" }],
        assex: ["1 anno fa", "oggi"] } : null;
    }
    case "fed_market":
      return (m.fed_market?.fedfunds || []).length > 2
        ? { punti: m.fed_market.fedfunds, soglie: [{ v: 4, testo: "comprime i multipli", colore: "var(--yellow)" }], unita: "%" } : null;
    case "decouple": {
      const dc = m.decouple || {};
      return (dc.sp500 || []).length > 2 && (dc.gdp || []).length > 2
        ? { doppia: [{ nome: "S&P 500", punti: dc.sp500, colore: "var(--blue)" },
                     { nome: "PIL reale", punti: dc.gdp, colore: "var(--muted)", tratteggio: true }],
            soglie: [{ v: 100, testo: "partenza", colore: "var(--border)" }] } : null;
    }
    case "corp_profit": {
      const cp = m.corp_profit || {};
      return (cp.ndx || []).length > 2 && (cp.profits || []).length > 2
        ? { doppia: [{ nome: "Nasdaq 100", punti: cp.ndx, colore: "var(--purple)" },
                     { nome: "Profitti reali", punti: cp.profits, colore: "var(--muted)", tratteggio: true }],
            soglie: [{ v: 100, testo: "partenza", colore: "var(--border)" }] } : null;
    }
    default: {
      // serie accumulata dalla pipeline giorno per giorno (v224): compare da sola appena
      // ci sono almeno due rilevazioni
      const st = (DATA?.metrics_history || []).map(x => ({ d: x.date, v: x.macro_scores?.[k] }))
        .filter(x => typeof x.v === "number");
      return st.length > 2 ? { punti: st, soglie: [{ v: 50, testo: "neutro", colore: "var(--muted)" }],
        accumulata: true } : null;
    }
  }
}

/* ═══ v225 — IL QUADRANTE: per chi non ha una serie, un grafico che si legge in un istante ══
   Il misuratore era ancora una BARRA, e il CEO ha ragione: fra 28 barre uguali non si legge
   niente al volo. Un quadrante ad arco con la lancetta si interpreta senza pensarci — la
   posizione dell'ago È il messaggio — ed è diverso a colpo d'occhio da una linea nel tempo,
   quindi si capisce subito quali indicatori hanno uno storico e quali no. */
/* v226 — `quadrante()` RIMOSSA, come `misuratore()` prima di lei. Erano due geometrie diverse
   dello stesso errore: UN widget per OGNI indicatore, trenta volte di fila. Il CEO le ha
   respinte entrambe e aveva ragione due volte — il problema non era l'arco o la barra, era la
   RIPETIZIONE. Ora i 30 indicatori sono DUE grafici (ragnatela + punti su un asse), non 30.
   RICEVUTA DEL TAGLIO, scritta prima di tagliare: 0 chiamanti residui, 0 riferimenti nei test,
   e dentro i confini del blocco non vive nessun'altra funzione — verificato con un assert,
   che alla prima stesura ha MORSO: il confine sbagliato si sarebbe portato via l'intero modulo
   del riordino v225. E' esattamente la classe v201-v204 (un taglio che prende il vicino). */

/* ═══ v225 — L'ORDINE DELLE SEZIONI, TRASCINABILE E UGUALE SU OGNI DEVICE ═══════════════════
   Richiesta CEO: "dammi la possibilità di trascinarli per ordinarli e se lo faccio questo deve
   essere salvato cosicché l'ordine rimanga a prescindere se apro la pagina da mac o iphone".

   Tre decisioni, ognuna con una ragione già pagata in questo progetto:

   1. LA CHIAVE E' `data-sez`, NON IL TITOLO NE' L'INDICE. Accoppiare due cose per il loro nome
      visibile e' fragile per costruzione (v196); per indice invecchia da solo (C10, red team
      I6). Una sezione nuova non sposta niente: finisce in coda (stessa regola di v191).
   2. SI PERMUTANO LE POSIZIONI, NON SI SPOSTANO GLI ELEMENTI NEL DOM LIBERAMENTE. Le sezioni di
      un pane non sono contigue e ci sono elementi senza `data-pane` che devono restare dove
      sono. Si piantano dei segnaposto nelle posizioni attuali e ci si rimettono dentro le
      sezioni nell'ordine nuovo: cio' che non e' una sezione del pane non si muove mai.
   3. POINTER EVENTS, NON HTML5 DRAG-AND-DROP. Il drag HTML5 non esiste su Safari touch — il CEO
      trascinava e non succedeva nulla (v193). Le frecce ▲▼ restano come seconda strada, e
      passano dalla STESSA funzione: due percorsi separati divergerebbero.

   La persistenza e' quella gia' collaudata per cap/veto (v-risk_params): file nel repo via
   Contents API. localStorage da solo NON soddisfa la richiesta — e' per-browser, quindi Mac e
   iPhone resterebbero diversi, che e' esattamente il difetto corretto sui parametri di rischio. */
const SEZ_ORDER_PATH = "config/ui_order.json";
const SEZ_ORDER_KEY = "sezioni_ordine";

function caricaOrdineSezioni() {
  try { const o = JSON.parse(localStorage.getItem(SEZ_ORDER_KEY) || "{}"); return (o && typeof o === "object") ? o : {}; }
  catch { return {}; }
}

function sezioniDelPane(pane) {
  const main = document.querySelector(".shell-main"); if (!main) return [];
  return [...main.children].filter(el => el.matches?.(`section[data-sez][data-pane="${pane}"]`));
}

/* Rimette le sezioni di un pane nelle POSIZIONI che occupano adesso, ma nell'ordine chiesto.
   I segnaposto sono commenti: invisibili, non impaginano, e ancorano una posizione che non si
   sposta mentre si muovono gli elementi. */
function disponiSezioni(pane, chiavi) {
  const lista = sezioniDelPane(pane);
  if (lista.length < 2) return;
  const noti = chiavi.map(k => lista.find(el => el.dataset.sez === k)).filter(Boolean);
  const resto = lista.filter(el => !noti.includes(el));          // sezioni nuove → in coda
  const nuovo = [...noti, ...resto];
  if (nuovo.every((el, i) => el === lista[i])) return;           // gia' cosi': non toccare il DOM
  const ancore = lista.map(el => { const c = document.createComment("sez"); el.replaceWith(c); return c; });
  nuovo.forEach((el, i) => ancore[i].after(el));
  ancore.forEach(c => c.remove());
}

function applicaOrdineSezioni() {
  const ord = caricaOrdineSezioni();
  for (const pane of Object.keys(ord)) if (Array.isArray(ord[pane])) disponiSezioni(pane, ord[pane]);
}

function salvaOrdineSezioni(pane) {
  const ord = caricaOrdineSezioni();
  ord[pane] = sezioniDelPane(pane).map(el => el.dataset.sez);
  ord._savedAt = new Date().toISOString();
  try { localStorage.setItem(SEZ_ORDER_KEY, JSON.stringify(ord)); } catch { /* quota */ }
  if (localStorage.getItem("gh_token")) pushOrdineSezioniCloud(ord);
  else toast("Ordine salvato solo su questo browser: senza token GitHub non arriva su iPhone");
}

async function pushOrdineSezioniCloud(ord) {
  const token = localStorage.getItem("gh_token");
  if (!token) return;
  try {
    let sha;
    const g = await fetch(`https://api.github.com/repos/${REPO}/contents/${SEZ_ORDER_PATH}`, { headers: ghHeaders(token), cache: "no-store" });
    if (g.ok) sha = (await g.json()).sha;
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${SEZ_ORDER_PATH}`, {
      method: "PUT", headers: ghHeaders(token),
      body: JSON.stringify({ message: "Ordine sezioni dashboard (da dashboard)", content: btoa(unescape(encodeURIComponent(JSON.stringify(ord, null, 1)))), sha }),
    });
    toast(r.ok ? "Ordine salvato — sarà lo stesso su Mac e iPhone" : "Ordine salvato in locale: GitHub ha rifiutato la scrittura");
  } catch { toast("Ordine salvato in locale: nessuna rete verso GitHub"); }
}

async function loadOrdineSezioniCloud() {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${SEZ_ORDER_PATH}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const cloud = await r.json();
    if (!cloud || typeof cloud !== "object") return;
    const local = caricaOrdineSezioni();
    if ((cloud._savedAt || "") > (local._savedAt || "")) {      // vince il piu' recente
      localStorage.setItem(SEZ_ORDER_KEY, JSON.stringify(cloud));
      applicaOrdineSezioni();
    }
  } catch { /* nessun file remoto: vale l'ordine di index.html */ }
}

/* ── i comandi: una maniglia per trascinare, due frecce per chi trascina male (o su iPhone) ── */
function montaComandiSezioni() {
  document.querySelectorAll(".shell-main > section[data-sez]").forEach(sez => {
    if (sez.querySelector(":scope > .sez-cmd")) return;
    const c = document.createElement("div");
    c.className = "sez-cmd";
    c.innerHTML = `<button class="sez-grip" type="button" aria-label="Trascina per spostare la sezione" title="Trascina per spostare">⠿</button>
      <button class="sez-su" type="button" aria-label="Sposta la sezione in su" title="Sposta in su">▲</button>
      <button class="sez-giu" type="button" aria-label="Sposta la sezione in giù" title="Sposta in giù">▼</button>`;
    sez.prepend(c);
    c.querySelector(".sez-su").addEventListener("click", () => spostaSezione(sez, -1));
    c.querySelector(".sez-giu").addEventListener("click", () => spostaSezione(sez, +1));
    c.querySelector(".sez-grip").addEventListener("pointerdown", e => iniziaTrascinamento(e, sez));
  });
}

/* UNICA strada per applicare un ordine nuovo: frecce e trascinamento passano entrambe di qui. */
function spostaSezione(sez, delta) {
  const pane = sez.dataset.pane;
  const lista = sezioniDelPane(pane);
  const i = lista.indexOf(sez), j = i + delta;
  if (i < 0 || j < 0 || j >= lista.length) return;
  lista.splice(j, 0, lista.splice(i, 1)[0]);
  disponiSezioni(pane, lista.map(el => el.dataset.sez));
  salvaOrdineSezioni(pane);
  sez.scrollIntoView({ block: "nearest" });
}

function iniziaTrascinamento(e, sez) {
  if (e.button > 0) return;
  e.preventDefault();                       // su touch impedisce che il gesto diventi uno scroll
  const pane = sez.dataset.pane;
  const main = document.querySelector(".shell-main");
  let ordine = sezioniDelPane(pane);
  if (ordine.length < 2) return;
  /* Mentre si trascina le card si riducono alla loro intestazione: una card alta 600px farebbe
     saltare il layout a ogni scambio e costringerebbe a scorrere per vedere dove si sta
     lasciando. Cosi' l'elenco del pane sta tutto sullo schermo, anche su iPhone. */
  main.classList.add("in-riordino");
  sez.classList.add("sez-trascinata");
  const grip = e.currentTarget;
  try { grip.setPointerCapture(e.pointerId); } catch { /* browser senza capture */ }

  const muovi = ev => {
    const y = ev.clientY;
    const altri = ordine.filter(x => x !== sez);
    const idx = altri.filter(x => { const r = x.getBoundingClientRect(); return r.top + r.height / 2 < y; }).length;
    altri.splice(idx, 0, sez);
    if (altri.some((el, i) => el !== ordine[i])) {
      ordine = altri;
      disponiSezioni(pane, ordine.map(el => el.dataset.sez));
    }
  };
  const finisci = () => {
    grip.removeEventListener("pointermove", muovi);
    grip.removeEventListener("pointerup", finisci);
    grip.removeEventListener("pointercancel", finisci);
    main.classList.remove("in-riordino");
    sez.classList.remove("sez-trascinata");
    salvaOrdineSezioni(pane);
  };
  grip.addEventListener("pointermove", muovi);
  grip.addEventListener("pointerup", finisci);
  grip.addEventListener("pointercancel", finisci);
}

/* ═══ v241 — LE SCHEDE SI TRASCINANO COME SU UNA SCRIVANIA ══════════════════════════════════
   Richiesta CEO: "puoi anche consentirmi di trascinare e modificare le schede come se fosse un
   desktop? l'ordine che poi salvo dovrà presentarsi su qualsiasi terminale".
   Si riusa per intero la macchina delle SEZIONI (v225), che gia' risolve i tre problemi veri:
     · POINTER EVENTS, non HTML5 drag — su Safari touch il drag HTML5 non esiste (v193), quindi
       su iPhone non succederebbe niente;
     · la CHIAVE e' `data-scheda` (la chiave dell'indicatore: in:cpi, dollar, macroquant…), non
       il titolo (fragile, v196) e non l'indice (invecchia da solo, C10);
     · la PERSISTENZA sta nello stesso `config/ui_order.json` scritto via Contents API. E' questo
       che soddisfa "su qualsiasi terminale": localStorage e' per-browser, e Mac e iPhone
       resterebbero diversi — il difetto gia' corretto sui parametri di rischio.
   ⚠ Differenza vera rispetto alle sezioni: le schede stanno in una griglia BIDIMENSIONALE
   impaccata a masonry, non in una colonna. Il bersaglio non si trova confrontando le sole y:
   si guarda quale scheda sta SOTTO il puntatore. */
function schedeDi(box) {
  return box ? [...box.querySelectorAll(":scope > .mg-card[data-scheda]")] : [];
}

/* stessa tecnica delle sezioni: si piantano segnaposto invisibili nelle posizioni attuali e ci
   si rimettono dentro le schede nell'ordine nuovo, cosi' non si sposta nient'altro */
function disponiSchede(box, chiavi) {
  const lista = schedeDi(box);
  if (lista.length < 2) return;
  const noti = chiavi.map(k => lista.find(el => el.dataset.scheda === k)).filter(Boolean);
  const resto = lista.filter(el => !noti.includes(el));       // schede nuove → in coda
  const nuovo = [...noti, ...resto];
  if (nuovo.every((el, i) => el === lista[i])) return;
  const ancore = lista.map(el => { const c = document.createComment("sk"); el.replaceWith(c); return c; });
  nuovo.forEach((el, i) => ancore[i].after(el));
  ancore.forEach(c => c.remove());
}

function applicaOrdineSchede(box, id) {
  if (!box) return;
  const c = (caricaOrdineSezioni().schede || {})[id];
  if (Array.isArray(c) && c.length) disponiSchede(box, c);
}

function salvaOrdineSchede(box, id) {
  const ord = caricaOrdineSezioni();
  ord.schede = ord.schede || {};
  ord.schede[id] = schedeDi(box).map(el => el.dataset.scheda);
  ord._savedAt = new Date().toISOString();
  try { localStorage.setItem(SEZ_ORDER_KEY, JSON.stringify(ord)); } catch { /* quota */ }
  if (localStorage.getItem("gh_token")) pushOrdineSezioniCloud(ord);
  else toast("Ordine salvato solo su questo browser: senza token GitHub non arriva su iPhone");
}

function montaTrascinamentoSchede(box, id) {
  if (!box) return;
  schedeDi(box).forEach(card => {
    if (card.querySelector(":scope > .sk-grip")) return;
    const g = document.createElement("button");
    g.className = "sk-grip"; g.type = "button"; g.textContent = "⠿";
    g.title = "Trascina per spostare la scheda";
    g.setAttribute("aria-label", `Sposta la scheda ${card.dataset.scheda}`);
    card.prepend(g);
    g.addEventListener("pointerdown", e => trascinaScheda(e, card, box, id));
    // tastiera: frecce per chi non trascina (e per l'accessibilita')
    g.addEventListener("keydown", ev => {
      const d = ev.key === "ArrowLeft" ? -1 : ev.key === "ArrowRight" ? 1 : 0;
      if (!d) return;
      ev.preventDefault();
      const l = schedeDi(box), i = l.indexOf(card), j = i + d;
      if (j < 0 || j >= l.length) return;
      l.splice(j, 0, l.splice(i, 1)[0]);
      disponiSchede(box, l.map(x => x.dataset.scheda));
      salvaOrdineSchede(box, id);
      impaccaGriglia(document.querySelector(".shell-main"));
      g.focus();
    });
  });
}

function trascinaScheda(e, card, box, id) {
  if (e.button > 0) return;
  e.preventDefault();                        // su touch impedisce che il gesto diventi uno scroll
  if (schedeDi(box).length < 2) return;
  box.classList.add("in-riordino-schede");
  card.classList.add("sk-trascinata");
  const grip = e.currentTarget;
  try { grip.setPointerCapture(e.pointerId); } catch { /* browser senza capture */ }

  /* ═══ SCORRIMENTO AUTOMATICO AI BORDI ═════════════════════════════════════════════════════
     ⚠ Senza questo il trascinamento e' vero solo per spostamenti CORTI. Misurato: le 27 schede
     occupano ~3000px, e `elementFromPoint` — che e' come si trova il bersaglio — restituisce
     null fuori dal viewport, per definizione. Quindi portare la prima scheda in ventesima
     posizione era semplicemente impossibile: il punto d'arrivo non e' sullo schermo.
     Vicino al bordo la pagina scorre da sola, come su una scrivania vera. */
  let scorri = null;
  const autoScorrimento = (y) => {
    const banda = 90, passo = 14;
    const v = y < banda ? -passo : y > innerHeight - banda ? passo : 0;
    if (!v) { clearInterval(scorri); scorri = null; return; }
    if (scorri) return;
    scorri = setInterval(() => window.scrollBy(0, v), 16);
  };

  const muovi = ev => {
    autoScorrimento(ev.clientY);
    /* ⚠ in una griglia 2D il bersaglio NON si trova confrontando le y (era il metodo delle
       sezioni, che stanno in colonna): si guarda quale scheda e' sotto il puntatore. */
    const sotto = document.elementFromPoint(ev.clientX, ev.clientY);
    const target = sotto && sotto.closest ? sotto.closest(".mg-card[data-scheda]") : null;
    if (!target || target === card || target.parentElement !== box) return;
    const l = schedeDi(box);
    const i = l.indexOf(card), j = l.indexOf(target);
    if (i < 0 || j < 0) return;
    l.splice(j, 0, l.splice(i, 1)[0]);
    disponiSchede(box, l.map(x => x.dataset.scheda));
    impaccaGriglia(document.querySelector(".shell-main"));
  };
  const finisci = () => {
    clearInterval(scorri); scorri = null;      // lo scorrimento non deve sopravvivere al rilascio
    grip.removeEventListener("pointermove", muovi);
    grip.removeEventListener("pointerup", finisci);
    grip.removeEventListener("pointercancel", finisci);
    box.classList.remove("in-riordino-schede");
    card.classList.remove("sk-trascinata");
    salvaOrdineSchede(box, id);
    impaccaGriglia(document.querySelector(".shell-main"));
  };
  grip.addEventListener("pointermove", muovi);
  grip.addEventListener("pointerup", finisci);
  grip.addEventListener("pointercancel", finisci);
}

function renderStruttura() {
  if (!DATA) return;
  attivaHoverGrafici();
  renderConcentrazione();
  renderAllocGrafica();
  renderVsBenchmark();   // v214 — il fondo contro il suo indice
  // v235 — l'impaccamento sta in fondo a renderMacroGrafici: e' QUELLA a riempire #mg-tutti,
  // e gira DOPO renderStruttura (setTab le chiama in quest'ordine). Chiamarlo qui misurava una
  // griglia ancora vuota: 0 schede toccate, verificato in browser.
  registraImpaccamento();
}

/* ---------------- tabella ---------------- */
function sparkline(values) {
  if (!values || values.length < 2) return "";
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) =>
    `${(i / (values.length - 1)) * 110},${28 - ((v - min) / range) * 26}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  const color = up ? "var(--green)" : "var(--red)";
  return `<svg class="spark" viewBox="0 0 110 30" preserveAspectRatio="none">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6"/>
  </svg>`;
}

function meterBar(pct, color, text) {
  const w = Math.max(3, Math.min(100, pct));
  return `<div class="meter" title="${text}">
    <span class="meter-txt">${text}</span>
    <span class="meter-track"><span class="meter-fill" style="width:${w}%;background:${color}"></span></span>
  </div>`;
}

const RATING_LABELS = {
  strong_buy: ["Strong Buy", "good"], buy: ["Buy", "good"],
  hold: ["Hold", "neutral"], underperform: ["Underperf.", "bad"],
  sell: ["Sell", "bad"], strong_sell: ["Strong Sell", "bad"],
};

function targetBar(r) {
  if (!r || r.upside_pct === null || r.upside_pct === undefined) return "—";
  const u = r.upside_pct;   // upside alto = verde, negativo = rosso
  return meterBar(Math.abs(u) * 2, scoreColor(clamp(50 + u * 2.5)), signTxt(u));
}

function betaBar(r) {
  // beta vs NDX dalla regressione pipeline (betaOf), fallback Yahoo se non ancora disponibile
  const beta = typeof r === "object" ? betaOf(r) : r;
  const tk = typeof r === "object" ? r.ticker : null;
  const src = typeof r === "object" && r.beta_ndx != null ? "regressione 12M vs NDX" : "Yahoo (5A vs S&P)";
  if (beta === null || beta === undefined) return "—";
  const bar = meterBar(Math.min(beta, 3) / 3 * 100, scoreColor(clamp(100 - (beta - 0.5) * 55)), fmtNum.format(beta));
  if (!tk) return bar;
  return `<span class="beta-cell" data-beta-tk="${tk}" title="Beta ${src} (regressione log-rendimenti 12M vs Nasdaq 100)">${bar}</span>`;
}

function prepostCell(pp) {
  if (!pp || !pp.price) return '<span class="muted">—</span>';
  return `<span class="muted" style="font-size:10px">${pp.label}</span> ${fmtNum.format(pp.price)}
    <span class="${signCls(pp.change_pct)}">${signTxt(pp.change_pct)}</span>`;
}

function fmtVolume(v) {
  if (!v) return "—";
  if (v >= 1e9) return fmtNum.format(v / 1e9) + "B";
  if (v >= 1e6) return fmtNum.format(v / 1e6) + "M";
  if (v >= 1e3) return fmtNum.format(v / 1e3) + "K";
  return String(v);
}

/* cella Volume con RVol (Volume Relativo = volume oggi / media 30gg, dalla pipeline):
   RVol > 1.5 = flussi anomali (istituzionali in movimento) → flag [Volumi Anomali] */
function volumeCell(r) {
  const rv = r.vol_ratio;
  const rvHtml = rv != null
    ? `<br><span style="font-size:9.5px;color:${rv > 1.5 ? "var(--yellow)" : "var(--muted)"};font-family:var(--mono)">RVol ${fmtNum.format(rv)}×</span>${rv > 1.5 ? `<br><span class="badge badge-anom" title="Volume Relativo ${fmtNum.format(rv)}× la media 30gg: flussi anomali in corso (accumulo/distribuzione istituzionale o evento). Incrociare con news e price action.">[Volumi Anomali]</span>` : ""}`
    : "";
  return `<td class="num">${fmtVolume(r.volume)}${rvHtml}</td>`;
}

/* v206 — prima questa funzione si chiamava "Bar" e NON disegnava nessuna barra: il nome
   mentiva. La forza relativa è zero-centrata per natura (batti o non batti il benchmark),
   quindi la barra divergente è la sua resa ovvia. Scala fissa ±20pp per rendere le righe
   confrontabili fra loro invece che ognuna sulla propria. */
function rsBar(rs, bench) {
  if (rs == null) return "—";
  const color = rs >= 2 ? "var(--green)" : rs <= -2 ? "var(--red)" : "var(--muted)";
  const bl = bench === "sox" ? "SOX" : bench === "ndx" ? "NDX" : "S&P";
  const blHtml = bench ? ` <span class="muted" style="font-size:9px;vertical-align:middle">${bl}</span>` : "";
  const w = Math.min(50, Math.abs(rs) / 20 * 50);
  const barra = `<span class="rs-axis" title="scala fissa ±20 pp"><span class="rs-zero"></span>` +
    `<span class="rs-fill" style="${rs >= 0 ? `left:50%` : `left:${(50 - w).toFixed(1)}%`};width:${Math.max(w, 1).toFixed(1)}%;background:${color}"></span></span>`;
  return `<span class="rs-cell"><span class="${rs > 0 ? "pos" : rs < 0 ? "neg" : ""}" style="font-family:var(--mono);font-size:12px;color:${color}">${rs > 0 ? "+" : ""}${fmtNum.format(rs)}%</span>${blHtml}${barra}</span>`;
}

/* Popup esplicativo della colonna "RS 1M" (forza relativa vs indice di settore: SOX/NDX/S&P) */
/* scheda completa del titolo (tecnica + fondamentale) — utile soprattutto su iPhone (tap sul titolo) */
function openStockDetail(ticker) {
  const all = [...(DATA.portfolio || []), ...(DATA.watchlist || [])];
  const r = all.find(x => x.ticker === ticker);
  if (!r) return;
  const c = cur(r);
  const st = r.stats || {};
  const pct = (v) => v == null ? "—" : (Math.round(v * 1000) / 10) + "%";
  const row = (lab, val) => `<div class="sd-row"><span class="sd-lab">${lab}</span><span class="sd-val">${val}</span></div>`;
  const inPtf = (DATA.portfolio || []).some(p => p.ticker === r.ticker && p.qty);
  const tech = [
    inPtf ? row("Quantità", fmtNum.format(r.qty)) : "",
    inPtf ? row("PMC", c + fmtNum.format(r.pmc)) : "",
    row("Prezzo", c + fmtNum.format(r.price) + ` <span class="${signCls(r.change_pct)}">(${signTxt(r.change_pct)})</span>`),
    inPtf ? row("Guadagno", `<span class="${signCls(r.gain_eur)}">${signTxt(Math.round(r.gain_eur || 0), " €")}</span>`) : "",
    row("RSI 14", r.rsi ?? "—"),
    row("Supporto / Resistenza", `${r.support ? c + fmtNum.format(r.support) : "—"} / ${r.resistance ? c + fmtNum.format(r.resistance) : "—"}`),
    row("Beta vs NDX", r.beta_ndx != null ? `${fmtNum.format(r.beta_ndx)} <span class="muted" style="font-size:10px">(regressione 12M)</span>` : (r.beta != null ? `${fmtNum.format(r.beta)} <span class="muted" style="font-size:10px">(Yahoo)</span>` : "—")),
    row("Sharpe 1A", r.sharpe_1y != null ? `<b style="color:${sharpeColor(r.sharpe_1y)}">${fmtNum.format(r.sharpe_1y)}</b>` : "—"),
    row("Forza rel. 1M (settore)", r.rs_1m != null ? signTxt(r.rs_1m) : "—"),
    row("Forza rel. 1M vs NDX", r.rs_ndx_1m != null ? `<span class="${signCls(r.rs_ndx_1m)}">${signTxt(r.rs_ndx_1m, " pp")}</span>` : "—"),
    r.avg_corr != null ? row("Correlazione media ptf", `${fmtNum.format(r.avg_corr)}${r.max_corr != null ? ` <span class="muted" style="font-size:10px">(max ${fmtNum.format(r.max_corr)} con ${r.max_corr_with})</span>` : ""}`) : "",
    r.risk_contrib_pct != null ? row("Quota rischio ptf (MCR)", `${fmtNum.format(r.risk_contrib_pct)}%`) : "",
    row("Drawdown 52S", r.w52_dist_pct != null ? signTxt(r.w52_dist_pct) : "—"),
    row("Short float", st.short_float != null ? pct(st.short_float) : "—"),
    row("Segnale", `<span class="badge ${r.signal_class}">${r.signal}</span>${isAsimm(r) ? ` <span class="badge badge-asimm">⚡ASIMM</span>` : ""}`),
    r.rating?.upside_pct != null ? row("Target Δ", signTxt(r.rating.upside_pct)) : "",
    r.earnings_date ? row("Trimestrale", new Date(r.earnings_date).toLocaleDateString("it-IT")) : "",
  ].join("");
  const fcf = st.market_cap && st.fcf && st.fcf > 0 ? Math.round(st.market_cap / st.fcf * 10) / 10 : null;
  const fund = [
    row("P/E", st.pe_ttm || r.pe ? fmtNum.format(Math.round((st.pe_ttm || r.pe) * 10) / 10) + "×" : "—"),
    row("P/FCF", fcf ? fmtNum.format(fcf) + "×" : "—"),
    row("EV/EBITDA", st.ev_ebitda ? fmtNum.format(Math.round(st.ev_ebitda * 10) / 10) + "×" : "—"),
    row("ROE / ROIC", st.roe != null ? pct(st.roe) + (st.roe > 0.15 ? " <span class='pos'>[premium]</span>" : st.roe < 0 ? " <span class='neg'>[zombie]</span>" : "") : "—"),
    row("Margine netto", st.profit_margin != null ? pct(st.profit_margin) : "—"),
    row("Crescita ricavi", st.revenue_growth != null ? pct(st.revenue_growth) : "—"),
    row("PEG", st.peg != null ? fmtNum.format(Math.round(st.peg * 100) / 100) : "—"),
    row("Altman Z-Score", st.altman_z != null ? `${fmtNum.format(st.altman_z)}${st.altman_z < 1.81 ? " <span class='neg'>[RISCHIO DEFAULT]</span>" : ""}` : "—"),
    row("P/B", st.price_to_book != null ? fmtNum.format(Math.round(st.price_to_book * 10) / 10) + "×" : "—"),
    row("Dividendo", st.dividend_yield != null ? pct(st.dividend_yield) : "—"),
  ].join("");
  const tv = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol(r))}`;
  openInfoModal(`${r.name} (${r.ticker})`,
    `<div class="sd-grid"><div class="sd-col"><h4>Tecnica & Prezzi</h4>${tech}</div>
      <div class="sd-col"><h4>Fondamentali</h4>${st.market_cap ? fund : '<div class="muted" style="font-size:12px">Fondamentali non disponibili</div>'}</div></div>
     <div style="margin-top:10px;text-align:center"><a class="btn btn-ghost btn-sm" href="${tv}" target="_blank" rel="noopener">Apri grafico TradingView ↗</a></div>`);
}

function openRsInfo(ticker) {
  const all = [...(DATA.portfolio || []), ...(DATA.watchlist || [])];
  const r = all.find(x => x.ticker === ticker);
  if (!r) return;
  const BENCH = {
    sox: { lab: "SOX — PHLX Semiconductor Index", why: "indice dei semiconduttori: il benchmark giusto per chip/hardware AI (NVDA, AMD, MU, AVGO…)" },
    ndx: { lab: "Nasdaq 100 (NDX)", why: "le 100 maggiori società tech/growth USA: benchmark per software, big tech e crescita" },
    sp500: { lab: "S&P 500", why: "le 500 maggiori società USA: benchmark generale per finanziari, difensivi e titoli value" },
  };
  const bk = r.rs_bench && BENCH[r.rs_bench] ? r.rs_bench : "sp500";
  const b = BENCH[bk];
  const rs = r.rs_1m;
  const verdict = rs == null ? null
    : rs >= 5 ? { t: "LEADERSHIP FORTE", c: "var(--green)", d: "il titolo è molto più forte del suo settore: capitale istituzionale in entrata, trend dominante. Da mantenere/cavalcare." }
    : rs >= 2 ? { t: "Sovraperformance", c: "var(--green)", d: "batte il settore: forza relativa positiva, leadership in costruzione." }
    : rs > -2 ? { t: "In linea col settore", c: "var(--muted)", d: "si muove come il suo benchmark: nessuna divergenza di forza significativa." }
    : rs > -5 ? { t: "Sottoperformance", c: "var(--red)", d: "più debole del settore: possibile rotazione in uscita o debolezza relativa, da monitorare." }
    : { t: "DEBOLEZZA STRUTTURALE", c: "var(--red)", d: "molto più debole del settore: laggard, capitale in fuga. Verificare se la tesi è ancora valida (Tax Alpha / scudo fiscale)." };
  // confronto Day% vs benchmark odierno (se disponibile)
  const bmDay = (DATA.macro || {}).benchmarks || {};
  const dayBench = bmDay[bk];
  const dayAlpha = (r.change_pct != null && dayBench != null) ? r.change_pct - dayBench : null;
  openInfoModal(`Forza Relativa (RS 1M) — ${r.name} (${ticker})`,
    `<div class="info-line" style="margin-bottom:10px"><b>Cos'è la "Forza Relativa" (RS)?</b><br>È la differenza tra la performance del titolo e quella del suo <b>indice di settore</b> nell'ultimo mese. Misura se il titolo è un <b>leader</b> (più forte del settore) o un <b>laggard</b> (più debole). È il filtro che usano gli istituzionali per capire DOVE sta entrando il capitale: si comprano i leader, si evitano/vendono i laggard.</div>
     <div class="info-line" style="background:var(--card-2);border-radius:8px;padding:10px;margin-bottom:10px">
       <div style="font-size:13px;margin-bottom:4px">${ticker} vs settore: <b style="color:${verdict ? verdict.c : 'var(--muted)'};font-size:18px">${rs != null ? (rs > 0 ? "+" : "") + fmtNum.format(rs) + "%" : "n.d."}</b> (1 mese)</div>
       ${verdict ? `<div style="font-size:13px;color:${verdict.c};font-weight:700">${verdict.t}</div><div class="muted" style="font-size:12px;margin-top:3px">${verdict.d}</div>` : `<div class="muted" style="font-size:12px">Dato di forza relativa non ancora disponibile per questo titolo.</div>`}
     </div>
     <h4 style="margin:8px 0 4px">Benchmark usato per ${ticker}</h4>
     <div class="info-line"><b>${b.lab}</b><br><span class="muted" style="font-size:12px">${b.why}</span></div>
     <div class="info-line muted" style="font-size:11.5px;margin-top:6px">Ogni titolo viene confrontato con l'indice più pertinente al suo settore: semiconduttori → <b>SOX</b>, tech/software/growth → <b>Nasdaq 100</b>, finanziari/value/difensivi → <b>S&P 500</b>. Confrontare NVDA con l'S&P darebbe un segnale fuorviante: va confrontato con gli altri chip (SOX).</div>
     ${dayAlpha != null ? `<h4 style="margin:10px 0 4px">Oggi vs benchmark</h4><div class="info-line">${ticker} oggi <span class="${signCls(r.change_pct)}">${signTxt(r.change_pct)}</span> · ${b.lab.split(" —")[0]} <span class="${signCls(dayBench)}">${signTxt(dayBench)}</span> → alpha giornaliero <b class="${signCls(dayAlpha)}">${signTxt(Math.round(dayAlpha*100)/100)} pp</b></div>` : ""}
     <div class="info-line muted" style="font-size:11px;margin-top:8px">Regola operativa: forza relativa positiva e crescente = mantieni/accumula (capitale in entrata). Forza relativa molto negativa = laggard: candidato a rotazione o, se i fondamentali sono rotti (ROIC<0), a "scudo fiscale" (Tax Alpha).</div>`);
}

function shortFloatCell(r) {
  const sf = (r.stats || {}).short_float;
  if (sf == null) return `<td class="num muted">—</td>`;
  const pct = Math.round(sf * 1000) / 10;
  const squeeze = pct > 12;
  return `<td class="num">${pct}%${squeeze ? `<br><span class="badge badge-squeeze badge-info" data-badge="squeeze" role="button" tabindex="0" title="Clicca per la spiegazione">[Squeeze Risk]</span>` : ""}</td>`;
}

/* Flottante: azioni liberamente scambiabili. Evidenzia il rischio short squeeze quando il
   float è ridotto (<50M) E lo short interest è elevato (>=15%) E i volumi sono anomali (>1,5×). */
function floatCell(r) {
  const st = r.stats || {};
  const fs = st.float_shares;
  if (fs == null) return `<td class="num muted">—</td>`;
  const txt = fs >= 1e9 ? (fs / 1e9).toFixed(1) + "B" : Math.round(fs / 1e6) + "M";
  const pct = st.float_pct != null ? `<br><span class="muted" style="font-size:9px">${fmtNum.format(st.float_pct)}%</span>` : "";
  const squeeze = fs < 50e6 && (st.short_float ?? 0) >= 0.15 && (r.vol_ratio ?? 0) > 1.5;
  return `<td class="num" title="Flottante ${fmtNum.format(Math.round(fs / 1e6))}M azioni${st.float_pct != null ? ` (${fmtNum.format(st.float_pct)}% del totale)` : ""}${squeeze ? " — LOW FLOAT + Short≥15% + RVol>1,5: rischio short squeeze" : ""}">${squeeze ? `<b class="neg">${txt}</b>` : txt}${pct}${squeeze ? `<br><span class="badge badge-squeeze">[LOW FLOAT]</span>` : ""}</td>`;
}

function drawdownCell(r) {
  const d = r.w52_dist_pct;
  if (d == null) return `<td class="num muted">—</td>`;
  // barra su scala 0…−50%: le soglie -15 (correzione) e -25 (deep value) erano scritte solo
  // nel codice, ora sono visibili come lunghezza invece che da ricordare a memoria
  const cls = d <= -25 ? "bar-pos" : d <= -15 ? "bar-warn" : "bar-neg";
  const badge = d <= -25
    ? `<br><span class="badge badge-deep-value badge-info" data-badge="deepvalue" role="button" tabindex="0" title="Clicca per la spiegazione">[DEEP VALUE]</span>`
    : d <= -15 ? `<br><span class="badge badge-correction badge-info" data-badge="correction" role="button" tabindex="0" title="Clicca per la spiegazione">[CORRECTION: Z1]</span>` : "";
  return cellaBarra(d, 50, `<span class="${d < 0 ? "neg" : "pos"}">${signTxt(d)}</span>${badge}`,
    { cls, title: "distanza dal massimo 52 settimane · barra su scala 0…−50%" });
}

/* spiegazione dei badge (Squeeze Risk, Deep Value, Correzione, RSI ipervenduto) */
const BADGE_INFO = {
  squeeze: ["Short Squeeze Risk", "Più del 12% del flottante è venduto allo scoperto. Se il titolo sale, gli short sono costretti a ricomprare per chiudere le posizioni, alimentando un rialzo esplosivo (short squeeze). È un segnale di potenziale volatilità rialzista violenta — interessante per posizioni speculative, rischioso per chi è short."],
  deepvalue: ["Deep Value — Deploy Cash", "Il titolo è sceso oltre il 25% dal massimo delle 52 settimane: massima asimmetria rischio/rendimento per chi accumula con orizzonte lungo (Diamond Hands). Zona di massimo interesse per schierare la liquidità tattica con ordini limite, se la tesi fondamentale è intatta."],
  correction: ["Correzione — Zona 1", "Il titolo è in correzione (tra -15% e -25% dal massimo 52 settimane): primo livello di accumulo. Considera di impiegare il 25-30% della liquidità tattica con ordini limite ai supporti. Verifica che non sia una rottura strutturale dei fondamentali."],
  oversold: ["RSI ipervenduto", "L'RSI è sotto 30: il titolo è statisticamente ipervenduto nel breve termine, spesso prelude a un rimbalzo tecnico. Da solo non è un segnale d'acquisto: incrocialo con supporto, trend e fondamentali."],
  overbought: ["RSI ipercomprato", "L'RSI è sopra 70: il titolo è ipercomprato nel breve, possibile pausa/ritracciamento. Per le posizioni vincenti (Diamond Hands) NON è un motivo di vendita, ma può suggerire un TRIM parziale (Free Ride) se il multiplo è teso."],
};
function openBadgeInfo(type) {
  const b = BADGE_INFO[type];
  if (!b) return;
  openInfoModal(b[0], `<div class="info-line" style="font-size:13px;line-height:1.65">${b[1]}</div>`);
}

/* Cella Sharpe 1A: verde brillante >2, verde tenue 1-2, grigio <1 (cliccabile per spiegazione) */
function sharpeColor(s) {
  if (s == null) return "var(--muted)";
  if (s > 2) return "var(--green)";
  if (s >= 1) return "#86c52a";       // verde tenue
  if (s >= 0) return "var(--muted)";
  return "var(--red)";                // negativo = sottoperforma il risk-free
}
function sharpeCell(r) {
  const s = r.sharpe_1y;
  if (s == null) return `<td class="num muted">—</td>`;
  return `<td class="num sharpe-cell" data-sharpe-tk="${r.ticker}" role="button" tabindex="0" title="Sharpe Ratio 12 mesi — clicca per la spiegazione"><b style="color:${sharpeColor(s)};font-family:var(--mono)">${fmtNum.format(s)}</b></td>`;
}

function sortinoCell(r) {
  const s = r.sortino_1y;
  if (s == null) return `<td class="num muted" title="Sortino n.d. — arriva col prossimo run della pipeline">—</td>`;
  const veto = s < -0.3;
  return `<td class="num" title="Sortino 12 mesi (solo volatilità negativa) — metro del veto value trap${veto ? ": SOTTO la soglia -0.3" : ""}"><b style="color:${veto ? "var(--red)" : sharpeColor(s)};font-family:var(--mono)">${fmtNum.format(s)}</b>${veto ? '<br><span class="badge badge-squeeze">[VETO]</span>' : ""}</td>`;
}

function openSharpeInfo(ticker) {
  const all = [...(DATA.portfolio || []), ...(DATA.watchlist || [])];
  const r = all.find(x => x.ticker === ticker);
  if (!r) return;
  const s = r.sharpe_1y;
  const rf = ((DATA.totals || {}).risk_free_rate ?? 0.0363) * 100;
  const pSharpe = (DATA.totals || {}).portfolio_sharpe_ratio;
  const verdict = s == null ? null
    : s > 2 ? { t: "ECCELLENTE", c: "var(--green)", d: "rendimento per unità di rischio molto alto: il titolo ha pagato bene la volatilità sopportata." }
    : s >= 1 ? { t: "BUONO", c: "#86c52a", d: "rendimento corretto per il rischio solido (sopra 1 = accettabile per gli istituzionali)." }
    : s >= 0 ? { t: "DEBOLE", c: "var(--muted)", d: "rendimento che ha appena battuto (o quasi) il tasso privo di rischio: poco premio per la volatilità." }
    : { t: "NEGATIVO", c: "var(--red)", d: "ha reso meno del tasso privo di rischio: il rischio assunto NON è stato ripagato." };
  openInfoModal(`Sharpe Ratio (12 mesi) — ${r.name} (${ticker})`,
    `<div class="info-line" style="margin-bottom:10px"><b>Cos'è lo Sharpe Ratio?</b><br>Misura il <b>rendimento corretto per il rischio</b>: quanto extra-rendimento (sopra il tasso privo di rischio del <b>${fmtNum.format(rf)}%</b>) un titolo genera per ogni unità di volatilità. Formula: <span style="font-family:var(--mono)">(Rendimento annuo − ${fmtNum.format(rf)}%) ÷ Volatilità annua</span>. Più è alto, meglio il titolo "paga" il rischio che ti fa correre.</div>
     <div class="info-line" style="background:var(--card-2);border-radius:8px;padding:10px;margin-bottom:10px">
       <div style="font-size:13px;margin-bottom:4px">${ticker}: <b style="color:${sharpeColor(s)};font-size:20px">${s != null ? fmtNum.format(s) : "n.d."}</b></div>
       ${verdict ? `<div style="font-size:13px;color:${verdict.c};font-weight:700">${verdict.t}</div><div class="muted" style="font-size:12px;margin-top:3px">${verdict.d}</div>` : `<div class="muted" style="font-size:12px">Sharpe non ancora disponibile (servono ≥60 giorni di storico).</div>`}
     </div>
     <h4 style="margin:8px 0 4px">Scala di riferimento</h4>
     <table class="info-table"><tbody>
       <tr><td><b style="color:var(--green)">&gt; 2,0</b></td><td>Eccellente — rendimento/rischio molto efficiente</td></tr>
       <tr><td><b style="color:#86c52a">1,0 – 2,0</b></td><td>Buono — standard di qualità istituzionale</td></tr>
       <tr><td><b style="color:var(--muted)">0 – 1,0</b></td><td>Debole — poco premio per la volatilità</td></tr>
       <tr><td><b style="color:var(--red)">&lt; 0</b></td><td>Negativo — il rischio non è stato ripagato</td></tr>
     </tbody></table>
     ${pSharpe != null ? `<div class="info-line muted" style="font-size:11.5px;margin-top:8px">Sharpe complessivo del portafoglio (calcolato con la matrice di covarianza pesata per controvalore): <b style="color:${sharpeColor(pSharpe)}">${fmtNum.format(pSharpe)}</b>. Grazie alla diversificazione, lo Sharpe di portafoglio è spesso più alto della media dei singoli titoli.</div>` : ""}`);
}

/* ═══ v188 — CELLE FONDAMENTALI NELLA TABELLA PRINCIPALE.
   Prima "Tecnica & Prezzi" e "Fondamentale (Value)" erano due tabelle alternative dietro un
   interruttore: per confrontare il P/E col Sortino bisognava passare avanti e indietro. Ora
   sono una tabella sola, ed e' il selettore di colonne a decidere cosa vedere — che e' la
   ragione per cui il CEO ha chiesto le due cose insieme.
   Le celle restano identiche a quelle della vecchia vista fondamentale: stessi campi, stesse
   soglie, stessi flag. Cambia il contenitore, non il contenuto. */
/* v188: buildFundTable/renderFundTable/renderWlFundTable/setPtfView/setWlView RIMOSSE.
   Le due viste alternative "Tecnica & Prezzi" / "Fondamentale (Value)" sono diventate UNA
   tabella con tutte le colonne (techCells + fundCells) piu' il selettore di colonne: era la
   richiesta del CEO, e le due cose stanno insieme — si unisce perche' ora si puo' nascondere.
   Le chiamate superstiti diventano no-op invece di sparire una per una: se un domani qualcuno
   riaggancia un handler alla vista, trova una funzione che non rompe niente. */
const setPtfView = () => {}, setWlView = () => {};
const renderFundTable = () => {}, renderWlFundTable = () => {};

/* v208 — LE COLONNE FONDAMENTALI SONO STATE TAGLIATE, MA NON A CASO.
   Regola applicata: si toglie dalla pagina ciò che l'LLM RICEVE GIÀ dal payload, si tiene ciò
   che vive SOLO qui. Verificato generando il payload sui dati veri prima di tagliare: Market
   Cap, P/E, P/E fwd, EV/EBITDA, ROE, margine, P/FCF, crescita ricavi, PEG, Z-Score e Target Δ
   ci sono tutti (da 1 a 49 occorrenze ciascuno) — quelle sono uscite. Debt/Equity, Div Yield e
   Financial Health NON c'erano: tagliarle le avrebbe fatte sparire dal sistema, non dalla
   pagina. È esattamente la classe v201-v204 (un taglio che si porta via il vicino), evitata
   perché la ricevuta è stata scritta PRIMA. */
/* ═══ v251 — FINANCIAL HEALTH È UN PUNTEGGIO: al suo posto vanno i NUMERI che lo compongono ═
   Richiesta CEO: "in financial health i contenuti portali nella tabella principale".
   `fin_health` è un 0-100 fatto per il 40% dalla crescita dei ricavi, 30% dalla costanza degli
   utili e 30% dalla stabilità del margine. I dati grezzi ci sono già in `financials` (fino a 5
   anni di ricavi, utile netto e margine) e NON SONO MAI STATI MOSTRATI da nessuna parte.
   ⚠ Un punteggio composito nasconde di chi è il merito: 90/100 non dice se l'azienda cresce e
   guadagna poco o cresce poco e guadagna tanto. I tre numeri sì. */
function finanziariCells(r) {
  const f = (r.financials || []).slice().sort((a, b) => a.year - b.year);
  if (!f.length) return `<td class="num muted">—</td><td class="num muted">—</td><td class="num muted">—</td><td class="num muted">—</td>`;
  const u = f[f.length - 1];
  // crescita: CAGR sui ricavi della serie disponibile — è il 40% del punteggio che sostituisce
  const cagr = f.length >= 2 && f[0].revenue > 0
    ? (Math.pow(u.revenue / f[0].revenue, 1 / (f.length - 1)) - 1) * 100 : null;
  const seg = (v) => v == null ? "" : (v >= 0 ? "pos" : "neg");
  const anni = f.map(x => `${x.year}: ricavi ${fmtMcapShort(x.revenue)} · utile ${fmtMcapShort(x.net_income)} · margine ${fmtNum.format(x.margin)}%`).join("\n");
  return `<td class="num" title="${esc(anni)}">${fmtMcapShort(u.revenue)}</td>
    <td class="num ${seg(u.net_income)}" title="${esc(anni)}">${fmtMcapShort(u.net_income)}</td>
    <td class="num ${seg(u.margin)}">${fmtNum.format(u.margin)}%</td>
    <td class="num ${seg(cagr)}">${cagr == null ? "—" : signTxt(Math.round(cagr * 10) / 10)}</td>`;
}
function fundCells(r) {
  const st = r.stats || {};
  const pct = (v) => v == null ? "—" : (Math.round(v * 1000) / 10) + "%";
  return `<td class="num">${st.debt_to_equity == null ? "—" : fmtNum.format(Math.round(st.debt_to_equity * 10) / 10)}</td>
    <td class="num">${pct(st.dividend_yield)}</td>
    ${finanziariCells(r)}`;
}
/* market cap abbreviata: la tabella e' gia' larga, "1,2T" batte "1.200.000" */
function fmtMcapShort(v) {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e12) return fmtNum.format(Math.round(v / 1e11) / 10) + "T";
  if (a >= 1e9) return fmtNum.format(Math.round(v / 1e8) / 10) + "B";
  if (a >= 1e6) return fmtNum.format(Math.round(v / 1e5) / 10) + "M";
  return fmtNum.format(v);
}

function techCells(r) {
  const c = cur(r);
  // supporto/resistenza cambiano con il range selezionato (1S/1M/3M/1A)
  const tw = (r.tech_by_range || {})[sparkRange];
  const support = tw ? tw.support : r.support;
  const resistance = tw ? tw.resistance : r.resistance;
  // Δ SMA200: sopra la media di lungo = trend sano; sotto = trend compromesso (price action pura)
  const sma = r.sma200_dist_pct;
  const smaCell = sma != null
    ? `<td class="num"><span class="${sma >= 0 ? "pos" : "neg"}">${signTxt(sma)}</span></td>`
    : `<td class="num muted">n.d.</td>`;
  return `
      <td class="num">${betaBar(r)}</td>
      ${sharpeCell(r)}
      ${sortinoCell(r)}
      <td class="num">${support ? c + fmtNum.format(support) : "—"}</td>
      <td class="num">${resistance ? c + fmtNum.format(resistance) : "—"}</td>
      ${smaCell}
      <td class="num rs-cell" data-rs-tk="${r.ticker}" role="button" tabindex="0" title="Clicca per la spiegazione della forza relativa (RS)">${rsBar(r.rs_1m, r.rs_bench)}</td>
      ${r.rs_ndx_1m != null
        ? `<td class="num" title="Sovra/sotto-performance a 1 mese vs Nasdaq 100 (metro del mandato)"><span class="${signCls(r.rs_ndx_1m)}">${signTxt(r.rs_ndx_1m, " pp")}</span></td>`
        : `<td class="num muted" title="Disponibile dopo il prossimo run della pipeline">n.d.</td>`}
      /* v251 — COLONNA "Segnale" RIMOSSA: era un'etichetta calcolata da RSI e distanza dalla
         SMA200, cioè da DUE COLONNE già presenti nella stessa riga. Un verdetto travestito da
         dato, e il CEO l'ha nominata per prima.
         ⚠ Dentro quella cella vivevano ANCHE [STOP VIOLATO] e ⚡ASIMM, che verdetti non sono:
         lo stop violato è spostato sulla colonna Titolo (fissa, non nascondibile), dove un
         allarme deve stare. ⚡ASIMM esce: è un'etichetta derivata da Sortino e Sharpe, entrambi
         colonne. Classe v201-v204 evitata scrivendo la ricevuta prima del taglio. */

      ${shortFloatCell(r)}
      ${floatCell(r)}
      ${drawdownCell(r)}
      ${optImpactCell(r.ticker)}
      ${earningsCell(r)}
      /* v251 — COLONNA "Grafico" RIMOSSA (richiesta CEO: elimina i grafici dalla tabella).
         Lo sparkline resta raggiungibile dalla scheda del titolo, che si apre dal nome. */`;
}

/* ═══ v228 — GIORNI DI CALENDARIO ALLA TRIMESTRALE, UNA SOLA VOLTA ═════════════════════════
   Trovato eseguendo il payload su me stesso. PLTR riportava gli utili OGGI (2026-08-03), aveva
   lo stop violato ed era in portafoglio: il caso piu' urgente che esista. Nella tabella portava
   [!EARNINGS RISK], ma nella riga PRIORITÀ del brief NON compariva — c'erano solo AMD e RGTI,
   che riportano DOPO. Causa: due implementazioni della stessa domanda.
     · la tabella: Math.ceil((data − adesso)/86400000)  → -0,45 diventa -0 → passa
     · il brief:   (data − adesso)/86400000 >= 0        → -0,45 → NON passa
   `new Date("2026-08-03")` e' la MEZZANOTTE di oggi, che alle 10:48 e' gia' passata: la
   trimestrale del giorno stesso risultava nel passato. E' la classe v161/v207 — due derivazioni
   della stessa grandezza divergono in silenzio — e qui il difetto nascondeva l'evento piu'
   urgente proprio nella riga che si chiama PRIORITÀ.
   Qui si contano GIORNI DI CALENDARIO in ora locale: oggi = 0, domani = 1. Chiunque chieda
   "fra quanto riporta" passa da questa funzione, cosi' non possono piu' divergere. */
function giorniAllaTrimestrale(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).length === 10 ? iso + "T00:00:00" : iso);   // locale, non UTC
  if (isNaN(d)) return null;
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const quel = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((quel - oggi) / 86400000);
}

/* trimestrale entro 14 giorni solari = rischio evento binario → flag [!EARNINGS RISK] */
function earningsRiskDays(r) {
  const days = giorniAllaTrimestrale(r.earnings_date);
  return (days != null && days >= 0 && days < 14) ? days : null;
}

/* cella Trimestrale in tabella: data earnings + Implied Move (±%) + flag rischio evento */
function earningsCell(r) {
  if (!r.earnings_date) return `<td class="num muted">—</td>`;
  const days = giorniAllaTrimestrale(r.earnings_date);
  if (days == null || days < -1) return `<td class="num muted">—</td>`;
  const d = new Date(r.earnings_date).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
  const col = days <= 7 ? "var(--red)" : days <= 21 ? "var(--yellow)" : "var(--muted)";
  const im = typeof impliedMoveForEarnings === "function" ? impliedMoveForEarnings(r) : null;
  const imHtml = im != null ? `<br><span style="font-size:9px;color:${im >= 10 ? "var(--yellow)" : "var(--muted)"}">±${im}%</span>` : "";
  const riskHtml = earningsRiskDays(r) != null
    ? `<br><span class="badge badge-earnrisk" title="Trimestrale tra ${days} giorni (<14): rischio evento binario — il gap post-earnings può scavalcare stop e supporti. Dimensiona/copri di conseguenza.">[!EARNINGS RISK]</span>` : "";
  return `<td class="num" style="white-space:nowrap"><span style="color:${col}">${d}</span>${imHtml}${riskHtml}</td>`;
}

function optImpactCell(ticker) {
  const chain = optChain(ticker);
  if (!chain || !(chain.expiries || []).length) return `<td class="num opt-col">—</td>`;
  const exp = chain.expiries[0];
  const avgVol = chain.avg_volume || 0;
  const optVol = exp.opt_volume || 0;
  const cw = exp.call_wall, pw = exp.put_wall;
  if (!avgVol) return `<td class="opt-col" style="cursor:pointer" data-opt="${ticker}">
    <span class="opt-col-walls muted">${cw ? "CW " + fmtNum.format(cw) : ""}${cw && pw ? " · " : ""}${pw ? "PW " + fmtNum.format(pw) : ""}</span>
  </td>`;
  const ratioPct = optVol * 100 / avgVol * 100;
  const fill = Math.max(2, Math.min(100, ratioPct));
  const [lab, , col] = ratioPct >= 30 ? ["ALTO", "", "var(--red)"]
                     : ratioPct >= 10 ? ["MEDIO", "", "var(--yellow)"]
                     : ["BASSO", "", "var(--green)"];
  return `<td class="opt-col" style="cursor:pointer" data-opt="${ticker}">
    <div class="opt-col-bar-wrap">
      <div class="opt-col-bar-track"><div class="opt-col-bar-fill" style="width:${fill.toFixed(0)}%;background:${col}"></div></div>
      <span class="opt-col-lab" style="color:${col}">${lab}</span>
    </div>
    ${(cw || pw) ? `<div class="opt-col-walls muted">${cw ? "CW " + fmtNum.format(cw) : ""}${cw && pw ? " · " : ""}${pw ? "PW " + fmtNum.format(pw) : ""}</div>` : ""}
  </td>`;
}

/* ═══ v206 — CELLE CON BARRA DI FONDO ═════════════════════════════════════════════════════
   "Meno numeri, più grafici" senza perdere un dato: la cifra RESTA leggibile, dietro le passa
   una barra proporzionale. Confrontare dieci righe smette di richiedere dieci letture.
   ⚠ Vale per costruzione la regola v188: mdRow() legge i campi grezzi di data.json e non
   guarda la UI, quindi qualunque resa grafica di una cella lascia il payload identico.
   `scala` = il valore che riempie la cella; `mid:true` centra la barra sullo zero. */
function cellaBarra(v, scala, testo, opt = {}) {
  if (v == null || !isFinite(v)) return `<td class="num muted">${testo ?? "—"}</td>`;
  const pct = Math.min(100, Math.abs(v) / (scala || 1) * 100);
  const seg = opt.cls || (v >= 0 ? "bar-pos" : "bar-neg");
  return `<td class="num bar-cell ${opt.mid ? "bar-mid " : ""}${seg}" style="--v:${pct.toFixed(0)}"` +
    `${opt.title ? ` title="${esc(opt.title)}"` : ""}>${testo}</td>`;
}

function finHealthBar(r) {
  if (r.fin_health === null || r.fin_health === undefined) return "—";
  const m3 = (r.financials || []).slice(-3).map(f => f.margin);
  const avgM = m3.length ? (m3.reduce((a, b) => a + b, 0) / m3.length).toFixed(1) : "—";
  const lab = r.fin_health >= 71 ? "Eccellente" : r.fin_health > 40 ? "Solido" : "Debole";
  return `<button class="fin-health" data-fin="${r.ticker}" title="${lab} — margine netto medio 3 anni: ${avgM}%">
    <span class="meter-txt">${r.fin_health}</span>
    <span class="meter-track"><span class="meter-fill" style="width:${Math.max(4, r.fin_health)}%;background:${scoreColor(r.fin_health)}"></span></span>
  </button>`;
}

/* modale "Conto economico": barre ricavi/utile + linea margine netto */
// metriche "Statistiche chiave": [etichetta, formato, spiegazione]
const fmtBig = v => v == null ? "—" : Math.abs(v) >= 1e12 ? (v / 1e12).toFixed(2) + " T" : Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(2) + " B" : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + " M" : fmtNum.format(v);
const fmtPctF = v => v == null ? "—" : fmtNum.format(Math.round(v * 1000) / 10) + "%";   // frazione → %
const fmtN2 = v => v == null ? "—" : fmtNum.format(v);
const STAT_META = {
  market_cap: ["Capitalizzazione", v => "$" + fmtBig(v), "Valore di mercato dell'azienda (prezzo × azioni)."],
  pe_ttm: ["P/E (TTM)", fmtN2, "Prezzo / utili ultimi 12 mesi. Alto = costoso o alte attese."],
  forward_pe: ["P/E prospettico", fmtN2, "Prezzo / utili attesi prossimi 12 mesi."],
  eps_ttm: ["EPS (TTM)", v => "$" + fmtN2(v), "Utile per azione ultimi 12 mesi."],
  eps_forward: ["EPS stimato", v => "$" + fmtN2(v), "Utile per azione atteso (consenso analisti)."],
  revenue_fy: ["Fatturato (FY)", v => "$" + fmtBig(v), "Ricavi dell'ultimo anno fiscale."],
  net_income_fy: ["Utile netto (FY)", v => "$" + fmtBig(v), "Utile netto dell'ultimo anno fiscale."],
  revenue_growth: ["Crescita ricavi", fmtPctF, "Crescita dei ricavi anno su anno."],
  earnings_growth: ["Crescita utili", fmtPctF, "Crescita degli utili anno su anno."],
  profit_margin: ["Margine netto", fmtPctF, "Utile netto / ricavi: redditività."],
  roe: ["ROE", fmtPctF, "Return on Equity: rendimento sul capitale proprio."],
  debt_to_equity: ["Debito/Equity", fmtN2, "Leva finanziaria: debito rispetto al capitale."],
  dividend_yield: ["Dividend yield", fmtPctF, "Rendimento da dividendo annuo."],
  price_to_book: ["Prezzo/Valore contabile", fmtN2, "Prezzo rispetto al patrimonio netto contabile."],
  shares: ["Azioni circolanti", fmtBig, "Numero di azioni in circolazione."],
  float_shares: ["Flottante", fmtBig, "Azioni effettivamente negoziabili sul mercato (escluse quelle vincolate di insider/società)."],
  float_pct: ["Flottante %", v => fmtN2(v) + "%", "Quota di azioni in libera circolazione: più è basso, più il titolo può essere volatile."],
  avg_volume_30d: ["Volume medio", fmtBig, "Volume di scambi medio giornaliero."],
  target_mean: ["Target medio analisti", v => "$" + fmtN2(v), "Prezzo obiettivo medio degli analisti."],
  fcf: ["Free cash flow", v => "$" + fmtBig(v), "Liquidità generata al netto degli investimenti."],
  altman_z: ["Altman Z''-Score", fmtN2, "Rischio insolvenza, variante Z'' per non-manifatturieri (tech/servizi, senza Sales/TA). Flag prudenziale <1,81; cutoff canonici Z'': <1,1 distress, >2,6 solido."],
};
function statScore(key, val) {
  if (val == null) return null;
  switch (key) {
    case "roe":            return clamp((val + 0.05) / 0.35 * 100);
    case "roa":            return clamp(val / 0.12 * 100);
    case "profit_margin":  return clamp(val / 0.25 * 100);
    case "gross_margin":   return clamp((val - 0.10) / 0.65 * 100);
    case "revenue_growth": return clamp((val + 0.05) / 0.30 * 100);
    case "earnings_growth":return clamp((val + 0.10) / 0.60 * 100);
    case "dividend_yield": return val > 0 ? clamp(val / 0.06 * 100) : null;
    case "ev_ebitda":      return clamp(100 - (val - 5) / 30 * 100);
    case "price_to_book":  return clamp(100 - (val - 1) / 9 * 100);
    case "forward_pe":     return clamp(100 - (val - 10) / 40 * 100);
    case "peg":            return clamp(100 - (val - 0.5) / 2 * 100);
    case "debt_to_equity": return clamp(100 - val / 4 * 100);
    case "float_pct":      return clamp(val / 80 * 100);
    case "altman_z":       return clamp((val - 1) / 2.5 * 100);
    default: return null;
  }
}
function statsGrid(stats) {
  const cells = Object.entries(STAT_META)
    .filter(([k]) => stats[k] != null)
    .map(([k, [lab, fmt, info]]) => {
      const sc = statScore(k, stats[k]);
      const bar = sc != null
        ? `<div class="stat-mini-bar"><div class="stat-mini-fill" style="width:${Math.round(sc)}%;background:${scoreColor(sc)}"></div></div>`
        : "";
      return `<button class="stat-cell" data-info="${esc(lab + ": " + info)}" title="${esc(info)}">
        <span class="stat-lab">${lab}</span><span class="stat-val">${fmt(stats[k])}</span>${bar}</button>`;
    }).join("");
  return cells ? `<h4 style="margin:12px 0 6px">Statistiche chiave</h4><div class="stats-grid">${cells}</div>` : "";
}

function openFinancialsModal(ticker) {
  const r = [...(DATA.portfolio || []), ...(DATA.watchlist || [])].find(x => x.ticker === ticker);
  if (!r || (!(r.financials || []).length && !r.stats)) { toast("Dati finanziari non disponibili per " + ticker); return; }
  const statsHtml = r.stats ? statsGrid(r.stats) : "";
  if (!(r.financials || []).length) {   // solo statistiche, niente storico conto economico
    openInfoModal(`${r.name} (${ticker}) — Dati finanziari`, statsHtml || '<p class="muted">Statistiche non disponibili.</p>');
    return;
  }
  const f = r.financials;
  // sintesi + previsione anno prossimo (stima dai trend)
  const yrs = f.length;
  const cagr = f[0].revenue > 0 ? ((f[yrs - 1].revenue / f[0].revenue) ** (1 / Math.max(1, yrs - 1)) - 1) : null;
  const niCagr = f[0].net_income > 0 && f[yrs - 1].net_income > 0 ? ((f[yrs - 1].net_income / f[0].net_income) ** (1 / Math.max(1, yrs - 1)) - 1) * 100 : null;
  const avgMargin = f.reduce((s, x) => s + x.margin, 0) / yrs;
  let forecast = null;
  if (cagr != null) {
    const g = Math.max(-0.3, Math.min(0.6, cagr));   // clamp crescita stimata
    const fr = Math.round(f[yrs - 1].revenue * (1 + g));
    forecast = { year: f[yrs - 1].year + 1, revenue: fr, net_income: Math.round(fr * avgMargin / 100), margin: Math.round(avgMargin * 10) / 10, est: true };
  }
  const draw = forecast ? f.concat([forecast]) : f;
  const W = 580, H = 300, pad = { l: 52, r: 48, t: 30, b: 30 };
  // scala simmetrica che include sia ricavi sia utili (così gli utili negativi non escono dal grafico)
  const vMax = Math.max(...draw.map(x => Math.max(Math.abs(x.revenue), Math.abs(x.net_income))), 1);
  const mMax = Math.min(100, Math.max(40, ...draw.map(x => Math.abs(x.margin))));   // asse margine limitato
  const clampM = v => Math.max(-mMax, Math.min(mMax, v));
  const n = draw.length, bw = (W - pad.l - pad.r) / n;
  const yV = v => pad.t + (1 - (v + vMax) / (2 * vMax)) * (H - pad.t - pad.b);
  const yM = v => pad.t + (1 - (clampM(v) + mMax) / (2 * mMax)) * (H - pad.t - pad.b);
  const fmtB = v => Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(1) + "B" : (v / 1e6).toFixed(0) + "M";
  const y0 = yV(0);
  let bars = "", line = "", labels = "";
  draw.forEach((x, i) => {
    const cx = pad.l + bw * i, w = bw * 0.30, op = x.est ? 0.5 : 1;
    const rb = `<rect x="${cx + bw * 0.14}" y="${Math.min(y0, yV(x.revenue)).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.abs(yV(x.revenue) - y0).toFixed(1)}" fill="#4c8dff" opacity="${op}"><title>Ricavi ${x.year}${x.est ? " (stima)" : ""}: ${fmtB(x.revenue)}</title></rect>`;
    const nb = `<rect x="${(cx + bw * 0.14 + w).toFixed(1)}" y="${Math.min(y0, yV(x.net_income)).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.abs(yV(x.net_income) - y0).toFixed(1)}" fill="#1e40af" opacity="${op}"><title>Utile ${x.year}${x.est ? " (stima)" : ""}: ${fmtB(x.net_income)}</title></rect>`;
    bars += rb + nb;
    // etichette valore sopra/sotto le barre (incluse le previsioni)
    labels += `<text x="${(cx + bw * 0.14 + w / 2).toFixed(1)}" y="${(Math.min(y0, yV(x.revenue)) - 3).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="#4c8dff">${fmtB(x.revenue)}</text>`;
    const niY = x.net_income >= 0 ? yV(x.net_income) - 3 : yV(x.net_income) + 9;
    labels += `<text x="${(cx + bw * 0.14 + w * 1.5).toFixed(1)}" y="${niY.toFixed(1)}" text-anchor="middle" font-size="8.5" fill="#7aa0ff">${fmtB(x.net_income)}</text>`;
    const px = cx + bw / 2, py = yM(x.margin);
    line += `${px.toFixed(1)},${py.toFixed(1)} `;
    labels += `<text x="${px.toFixed(1)}" y="${(H - 12).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--muted)">${x.year}${x.est ? "*" : ""}</text>`;
    labels += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3" fill="#f59e0b" opacity="${op}"><title>Margine ${x.year}: ${x.margin}%${Math.abs(x.margin) > mMax ? " (fuori scala — punto limitato al bordo per non rompere il grafico)" : ""}</title></circle>`;
  });
  const svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:300px">
    <line x1="${pad.l}" y1="${y0.toFixed(1)}" x2="${W - pad.r}" y2="${y0.toFixed(1)}" stroke="var(--border)"/>
    ${bars}
    <polyline points="${line}" fill="none" stroke="#f59e0b" stroke-width="2"/>
    ${labels}
    <text x="${pad.l - 6}" y="${(yV(vMax) + 4).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)">${fmtB(vMax)}</text>
    <text x="${pad.l - 6}" y="${(yV(-vMax) + 4).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)">−${fmtB(vMax)}</text>
    <text x="${W - pad.r + 6}" y="${(yM(mMax) + 4).toFixed(1)}" font-size="9" fill="#f59e0b">+${Math.round(mMax)}%</text>
    <text x="${W - pad.r + 6}" y="${(yM(-mMax) + 4).toFixed(1)}" font-size="9" fill="#f59e0b">−${Math.round(mMax)}%</text>
  </svg>
  <div class="cm-legend"><span><i style="background:#4c8dff"></i>Ricavi</span><span><i style="background:#1e40af"></i>Utile netto</span><span><i class="round" style="background:#f59e0b"></i>Margine netto %</span></div>`;
  // tabella annuale + sintesi + previsione
  const cagrPct = cagr != null ? cagr * 100 : null;
  const rows = draw.slice().reverse().map(x => `<tr${x.est ? ' style="opacity:.7"' : ""}><td>${x.year}${x.est ? " (stima)" : ""}</td><td>${fmtB(x.revenue)}</td><td class="${signCls(x.net_income)}">${fmtB(x.net_income)}</td><td class="${signCls(x.margin)}">${x.margin}%</td></tr>`).join("");
  const table = `<table class="info-table"><thead><tr><th>Anno</th><th>Ricavi</th><th>Utile netto</th><th>Margine</th></tr></thead><tbody>${rows}</tbody></table>`;
  const extra = `<div class="info-line" style="margin-top:8px">
    <b>CAGR ricavi (${yrs}a):</b> <span class="${signCls(cagrPct)}">${cagrPct != null ? signTxt(Math.round(cagrPct * 10) / 10) : "—"}</span>
    · <b>CAGR utile:</b> <span class="${signCls(niCagr)}">${niCagr != null ? signTxt(Math.round(niCagr * 10) / 10) : "—"}</span>
    · <b>Margine medio:</b> ${avgMargin.toFixed(1)}%${r.pe && r.pe > 0 ? ` · <b>P/E:</b> ${fmtNum.format(r.pe)}` : ""}${r.eps != null ? ` · <b>EPS:</b> ${fmtNum.format(r.eps)}` : ""}</div>`;
  const fcast = forecast ? `<div class="info-line"><b>Previsione ${forecast.year} (stima dai trend):</b> ricavi ~${fmtB(forecast.revenue)} · utile ~${fmtB(forecast.net_income)} · margine ~${forecast.margin}%</div>
    <div class="info-line muted" style="font-size:11px">* stima estrapolata da crescita ricavi e margine medio storici, non una previsione ufficiale.</div>` : "";
  openInfoModal(`${r.name} (${ticker}) — Conto economico`,
    `${svg}${extra}${fcast}${table}<div class="info-line muted" style="margin-top:8px">Financial Health Score: <b style="color:${scoreColor(r.fin_health)}">${r.fin_health ?? "—"}/100</b> · pesato su crescita ricavi, costanza utili e stabilità del margine.</div>${statsHtml}`);
}

/* ---------------- zoom grafico (modale, touch + mouse) ---------------- */
function closeChartModal() { $("#chart-modal").hidden = true; }

/* zoom del grafico di un singolo titolo, con selettore range e date sul punto */
let cmTicker = null, cmRange = "m1";
const CM_RANGES = [["d1", "1G"], ["w1", "1S"], ["m1", "1M"], ["m3", "3M"], ["m6", "6M"], ["y1", "1A"], ["all", "ALL"]];
const CM_SPAN = { d1: 1, w1: 7, m1: 31, m3: 92, m6: 183, y1: 365, all: 365 * 5 };   // giorni coperti (per le date)

// mappa range → parametri Yahoo (range, interval) per i dati OHLC reali
const CM_YF = {
  d1: ["1d", "5m"], w1: ["5d", "15m"], m1: ["1mo", "1d"], m3: ["3mo", "1d"],
  m6: ["6mo", "1d"], y1: ["1y", "1d"], all: ["max", "1wk"],
};

async function fetchOHLC(symbol, range, interval) {
  const yurl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  for (const make of CORS_PROXIES) {
    try {
      const r = await fetch(make(yurl), { cache: "no-store" });
      if (!r.ok) continue;
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      const q = res?.indicators?.quote?.[0];
      if (!res?.timestamp || !q) continue;
      const out = [];
      for (let i = 0; i < res.timestamp.length; i++) {
        if (q.open[i] == null || q.close[i] == null) continue;
        out.push({ t: res.timestamp[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
      }
      if (out.length > 1) return out;
    } catch { /* prossimo proxy */ }
  }
  return null;
}

/* simbolo TradingView: exchange noto per i titoli core, altrimenti ticker nudo */
const TV_EXCHANGE = {
  NVDA: "NASDAQ", AMD: "NASDAQ", MU: "NASDAQ", MSTR: "NASDAQ", RGTI: "NASDAQ",
  GOOGL: "NASDAQ", META: "NASDAQ", PLTR: "NASDAQ", AAPL: "NASDAQ", MSFT: "NASDAQ",
  AMZN: "NASDAQ", TSLA: "NASDAQ", AVGO: "NASDAQ", INTC: "NASDAQ", QCOM: "NASDAQ",
  CBRS: "NASDAQ", OKLO: "NYSE", SPCX: "NASDAQ",
};
function tvSymbol(r) {
  const tk = (r.ticker || "").replace("^", "");
  if (r.ticker && r.ticker.includes("-")) return tk;        // cripto/derivati: nudo
  const ex = TV_EXCHANGE[tk];
  return ex ? `${ex}:${tk}` : tk;
}
let cmView = "candles";   // "candles" | "tv"

function renderTvWidget(r) {
  const sym = encodeURIComponent(tvSymbol(r));
  const src = `https://s.tradingview.com/widgetembed/?frameElementId=tv_${r.ticker}` +
    `&symbol=${sym}&interval=D&hidesidetoolbar=0&symboledit=0&saveimage=0` +
    `&toolbarbg=131722&theme=dark&style=1&timezone=Europe/Rome&locale=it&withdateranges=1`;
  return `<div class="cm-tv-wrap">
    <iframe class="cm-tv" src="${src}" title="TradingView ${esc(r.ticker)}" frameborder="0" allowtransparency="true" scrolling="no" loading="lazy"></iframe>
    <div class="muted cm-tv-note">Grafico avanzato TradingView (dati di terze parti). Usa "Apri su TradingView ↗" per la versione completa.</div>
  </div>`;
}

function drawTickerChart() {
  const all = [...(DATA.portfolio || []), ...(DATA.watchlist || [])];
  const r = all.find(x => x.ticker === cmTicker);
  if (!r) return;
  // popup titolo: SOLO grafico TradingView (niente candele native), con link alla versione completa
  const tv = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol(r))}`;
  const controls = `<div class="cm-controls"><a class="btn btn-ghost btn-sm" href="${tv}" target="_blank" rel="noopener">Apri su TradingView ↗</a></div>`;
  $("#chart-modal-title").textContent = `${r.name} (${r.ticker})`;
  $("#chart-modal-tip").innerHTML = "";
  $("#chart-modal").hidden = false;
  $("#chart-modal-body").innerHTML = controls + renderTvWidget(r);
}

/* ===================== MODULO OPZIONI — Strike Ladder ===================== */
/* Dati reali generati dalla pipeline (Yahoo via yfinance) → DATA.options[ticker]. */
let optTicker = null, optExpIdx = 0, optSide = "call";

function optChain(ticker) {
  const o = DATA.options || {};
  return o[ticker] || o[(ticker || "").toUpperCase()] || null;
}
function hasOptions(ticker) {
  const c = optChain(ticker);
  return !!(c && c.expiries && c.expiries.length);
}

function openOptionsModal(ticker) {
  if (!hasOptions(ticker)) { toast("Catena opzioni non disponibile per " + ticker); return; }
  const all = [...(DATA.portfolio || []), ...(DATA.watchlist || [])];
  const r = all.find(x => x.ticker === ticker) || { ticker };
  optTicker = ticker; optExpIdx = 0; optSide = "call";
  cmTicker = ticker;   // così il pulsante "← Grafico" sa quale titolo mostrare
  $("#chart-modal-title").textContent = `Catena opzioni — ${r.name || r.ticker} (${r.ticker})`;
  $("#chart-modal-tip").innerHTML = "";
  $("#chart-modal").hidden = false;
  renderOptionsContent();
}

function loadOptionsView() { renderOptionsContent(); }   // re-render (toggle/scadenza)

/* grafico put/call indicativo: open interest per strike (call verde, put rosso), spot + muri */
function optOIChart(exp, spot, sym) {
  const byStrike = {};
  (exp.calls || []).forEach(o => { (byStrike[o.strike] = byStrike[o.strike] || {}).c = o.oi || 0; });
  (exp.puts || []).forEach(o => { (byStrike[o.strike] = byStrike[o.strike] || {}).p = o.oi || 0; });
  const strikes = Object.keys(byStrike).map(Number).sort((a, b) => a - b);
  if (strikes.length < 2) return "";
  const totC = strikes.reduce((s, k) => s + (byStrike[k].c || 0), 0);
  const totP = strikes.reduce((s, k) => s + (byStrike[k].p || 0), 0);
  const pcr = totC ? totP / totC : null;
  const maxOI = Math.max(1, ...strikes.map(s => Math.max(byStrike[s].c || 0, byStrike[s].p || 0)));
  const W = 620, H = 180, pad = { l: 8, r: 8, t: 16, b: 26 };
  const n = strikes.length, bw = (W - pad.l - pad.r) / n, base = H - pad.b;
  const x = i => pad.l + i * bw;
  const yH = v => v / maxOI * (H - pad.t - pad.b);
  const bars = strikes.map((s, i) => {
    const c = byStrike[s].c || 0, p = byStrike[s].p || 0, cx = x(i) + bw / 2, w = Math.max(1.5, bw * 0.34);
    return `<rect x="${(cx - w - 0.5).toFixed(1)}" y="${(base - yH(c)).toFixed(1)}" width="${w.toFixed(1)}" height="${yH(c).toFixed(1)}" fill="var(--green)" opacity="0.85"/>` +
           `<rect x="${(cx + 0.5).toFixed(1)}" y="${(base - yH(p)).toFixed(1)}" width="${w.toFixed(1)}" height="${yH(p).toFixed(1)}" fill="var(--red)" opacity="0.85"/>`;
  }).join("");
  const mark = (strike, col, lab) => {
    if (strike == null) return "";
    let bi = 0; strikes.forEach((s, i) => { if (Math.abs(s - strike) < Math.abs(strikes[bi] - strike)) bi = i; });
    const mx = x(bi) + bw / 2;
    return `<line x1="${mx.toFixed(1)}" y1="${pad.t}" x2="${mx.toFixed(1)}" y2="${base}" stroke="${col}" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>
      <text x="${mx.toFixed(1)}" y="${(pad.t - 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="${col}">${lab}</text>`;
  };
  const labIdx = [0, Math.floor(n / 2), n - 1];
  const labels = labIdx.map(i => `<text x="${(x(i) + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="var(--muted)">${sym}${fmtNum.format(strikes[i])}</text>`).join("");
  return `<div class="opt-oi-chart">
    <div class="opt-oi-head">Open interest per strike (Call vs Put)${pcr != null ? ` · P/C OI <b style="color:${scoreColor(clamp(100 - pcr / 2 * 100))}">${fmtNum.format(Math.round(pcr * 100) / 100)}</b>` : ""}</div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${bars}${mark(spot, "var(--text)", "spot")}${mark(exp.call_wall, "var(--green)", "CW")}${mark(exp.put_wall, "var(--red)", "PW")}${labels}</svg>
    <div class="opt-oi-leg"><span><span class="dot" style="background:var(--green)"></span>Call OI</span><span><span class="dot" style="background:var(--red)"></span>Put OI</span><span class="muted">CW=Call Wall · PW=Put Wall</span></div>
  </div>`;
}

function renderOptionsContent() {
  const tk = optTicker;
  const chain = optChain(tk);
  if (!chain) return;
  const all = [...(DATA.portfolio || []), ...(DATA.watchlist || [])];
  const row = all.find(x => x.ticker === tk) || {};
  const sym = row.currency === "EUR" ? "€" : "$";
  const exps = chain.expiries;
  if (optExpIdx >= exps.length) optExpIdx = 0;
  const exp = exps[optExpIdx];
  const spot = chain.spot ?? row.price ?? null;
  const side = optSide === "put" ? (exp.puts || []) : (exp.calls || []);
  const wallStrike = optSide === "put" ? exp.put_wall : exp.call_wall;
  const wallLab = optSide === "put" ? "[Put Wall]" : "[Call Wall]";

  const expSel = `<select class="pmc-input opt-expiry" style="width:auto;padding:4px 8px">` +
    exps.map((e, i) => `<option value="${i}" ${i === optExpIdx ? "selected" : ""}>${new Date(e.date + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}</option>`).join("") + `</select>`;
  const sideTog = `<div class="spark-toggle opt-side-tog" role="group">
      <button class="chip opt-side ${optSide === "call" ? "chip-active" : ""}" data-side="call">CALL</button>
      <button class="chip opt-side ${optSide === "put" ? "chip-active" : ""}" data-side="put">PUT</button></div>`;
  const controls = `<div class="cm-controls opt-controls">
      <button class="btn btn-ghost btn-sm cm-opt-back">← Grafico</button>
      <label class="bench-toggle">Scadenza: ${expSel}</label>
      ${sideTog}
      ${spot != null ? `<span class="muted">Spot: <b>${sym}${fmtNum.format(spot)}</b></span>` : ""}
    </div>`;

  // tachimetro d'impatto: volume opzioni (azioni equivalenti) vs volume medio del titolo
  const avgVol = chain.avg_volume || null;
  const optVol = exp.opt_volume || 0;
  let impactHtml = "";
  if (avgVol) {
    const ratioPct = optVol * 100 / avgVol * 100;            // 1 contratto = 100 azioni
    const fill = Math.max(2, Math.min(100, ratioPct));
    const lvl = ratioPct >= 30 ? ["ALTO", "I market maker guidano il prezzo", "var(--red)"]
              : ratioPct >= 10 ? ["MEDIO", "Le opzioni influenzano il titolo", "var(--yellow)"]
              : ["BASSO", "Peso marginale sul sottostante", "var(--green)"];
    impactHtml = `<div class="opt-impact">
        <div class="opt-impact-head">Impatto opzioni sul titolo: <b style="color:${lvl[2]}">${lvl[0]}</b> <span class="muted">(${lvl[1]})</span></div>
        <div class="opt-impact-track"><span class="opt-impact-fill" style="width:${fill.toFixed(0)}%;background:${lvl[2]}"></span>
          <span class="opt-impact-tick" style="left:10%"></span><span class="opt-impact-tick" style="left:30%"></span></div>
        <div class="opt-impact-foot muted">Volume opzioni ${fmtBig(optVol)} contratti (~${fmtBig(optVol * 100)} azioni eq.) · Vol. medio titolo ${fmtBig(avgVol)}</div>
      </div>`;
  }

  // ATM = strike più vicino allo spot dentro la finestra
  let atmStrike = null;
  if (spot != null && side.length) atmStrike = side.reduce((m, o) => Math.abs(o.strike - spot) < Math.abs(m - spot) ? o.strike : m, side[0].strike);

  const rows = side.map(o => {
    const isATM = o.strike === atmStrike;
    const isWall = wallStrike != null && o.strike === wallStrike;
    return `<tr class="${isWall ? "opt-wall" : ""} ${isATM ? "opt-atm" : ""}">
      <td>${sym}${fmtNum.format(o.strike)}${isATM ? ' <span class="opt-tag">ATM</span>' : ""}</td>
      <td>${o.bid != null ? fmtNum.format(o.bid) : "—"}</td>
      <td>${o.ask != null ? fmtNum.format(o.ask) : "—"}</td>
      <td>${o.iv != null && o.iv > 0 ? o.iv.toFixed(1) + "%" : "n.d."}</td>
      <td>${(o.vol || 0).toLocaleString("it-IT")}</td>
      <td>${(o.oi || 0).toLocaleString("it-IT")}${isWall ? ` <span class="opt-wall-lab">${wallLab}</span>` : ""}</td>
    </tr>`;
  }).join("");

  const wallNote = wallStrike != null
    ? `${optSide === "put" ? "Put Wall" : "Call Wall"} a <b>${sym}${fmtNum.format(wallStrike)}</b> (OI massimo) — ${optSide === "put" ? "supporto/magnete sotto il prezzo" : "resistenza/tetto sopra il prezzo"}.`
    : "";

  $("#chart-modal-body").innerHTML = controls + impactHtml + optOIChart(exp, spot, sym) + `
    <div class="table-wrap"><table class="opt-table">
      <thead><tr><th>STRIKE</th><th>BID</th><th>ASK</th><th>IV %</th><th>VOL</th><th>OPEN INTEREST</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="muted" style="text-align:center;padding:20px">Nessuno strike per questa scadenza</td></tr>`}</tbody>
    </table></div>
    <div class="muted" style="margin-top:8px;font-size:11px">${wallNote} ATM = strike più vicino al prezzo. Fonte: Yahoo Finance (OI a fine giornata, aggiornato dalla pipeline).</div>`;
}

/* grafico a candele: verde se chiude >= apre, rosso se scende */
function openTickerChart(ticker) {
  cmTicker = ticker; cmRange = sparkRange in CM_SPAN ? sparkRange : "m1";
  cmView = "candles";   // ogni apertura parte dalle candele native
  drawTickerChart();
}

/* ---------------- popup informativi (macro / trimestrali) ---------------- */
/* ---- mini chart helpers (per popup macro/credit/decouple) ---- */
function miniLineChart(pts, { w = 420, h = 70, color = "var(--blue)", zeroLine = false } = {}) {
  if (!pts || pts.length < 2) return '<div class="muted">Storico non disponibile</div>';
  const vals = pts.map(p => p.v);
  const mn = Math.min(...vals), mx = Math.max(...vals), rng = mx - mn || 0.01;
  const px = i => ((i / (pts.length - 1)) * (w - 4) + 2).toFixed(1);
  const py = v => (h - 4 - (v - mn) / rng * (h - 8) + 2).toFixed(1);
  const poly = pts.map((p, i) => `${px(i)},${py(p.v)}`).join(" ");
  const last = pts[pts.length - 1], first = pts[0];
  const zl = zeroLine && mn < 0 && mx > 0
    ? `<line x1="0" y1="${py(0)}" x2="${w}" y2="${py(0)}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 2"/>`
    : "";
  const dl = `${new Date(first.d).toLocaleDateString("it-IT", { month: "short", year: "2-digit" })} – ${new Date(last.d).toLocaleDateString("it-IT", { month: "short", year: "2-digit" })}`;
  return `<div class="mini-chart-wrap">
    <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;display:block">${zl}
      <polyline points="${poly}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>
      <circle cx="${px(pts.length - 1)}" cy="${py(last.v)}" r="3" fill="${color}"/>
    </svg>
    <div class="mini-chart-dates">${dl} · <b>${fmtNum.format(first.v)}</b> → <b>${fmtNum.format(last.v)}</b></div>
  </div>`;
}

/* v211 — QUANTO SPESSO QUESTO "ALLARME" È ACCESO.
   Nasce dal report che diceva di vendere tutto. Il payload pubblicava «margin debt = 100% del
   picco storico → RISCHIO SISTEMICO» senza dire che la serie è al proprio massimo in 11 mesi
   su 13: una misura che sta al suo massimo l'85% del tempo non è un allarme, è una costante,
   e un LLM che la legge come evento la conta come prova. CLAUDE.md lo annotava già
   ("pct_of_peak saturo 13/13") ma la riga del payload continuava a metterla per prima. */
function mesiAlPicco(serie) {
  const h = (serie || []).filter(v => typeof v === "number");
  if (h.length < 3) return null;
  let picco = -Infinity, conta = 0;
  h.forEach(v => { if (v >= picco) { conta++; picco = v; } else if (v > picco) picco = v; });
  return { conta, tot: h.length };
}

/* v207 — FONTE UNICA PER I RAMI FEDWATCH.
   Il difetto: v187 ha corretto il PAYLOAD ("prob. taglio 0%" era vero e inutile quando il
   mercato prezzava un RIALZO al 38%), ma il popup della dashboard è rimasto indietro — mostrava
   solo le colonne "Taglio" e "Invariato", cioè esattamente la mezza verità che il payload aveva
   smesso di raccontare. Due implementazioni della stessa cosa divergono: qui ce n'è una sola,
   usata da entrambi. Stessa lezione di v161 (usRegularSessionOpen derivata da usSessionInfo).
   La derivazione dal tasso implicito serve per compatibilità all'indietro: finché il CI non
   rigenera, i `meetings` possono non avere hike_prob. */
function ramiFedWatch(fw, riunione) {
  const mt = { ...(riunione || {}) };
  if (mt.hike_prob == null && fw?.implied_rate != null && fw?.target_range) {
    const [lo, hi] = String(fw.target_range).replace("%", "").split("–").map(Number);
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      const quarti = ((lo + hi) / 2 - fw.implied_rate) / 0.25 * 100;
      mt.cut_prob = Math.round(Math.max(0, Math.min(100, quarti)));
      mt.hike_prob = Math.round(Math.max(0, Math.min(100, -quarti)));
      mt.hold_prob = Math.max(0, 100 - mt.cut_prob - mt.hike_prob);
    }
  }
  return mt;
}

/* v207 — DUE SERIE NORMALIZZATE A 100 SU DATE DIVERSE NON SONO CONFRONTABILI.
   Sottrarne i valori finali non produce un "gap": produce la differenza fra due periodi
   diversi. Il caso reale: S&P rebasato su 7 settimane meno PIL rebasato su 3 anni, pubblicato
   nel payload come "disaccoppiamento -3 pp". La pipeline è stata corretta (v207,
   _finestra_comune + freq="m"), ma finché il CI non rigenera il file il payload leggerebbe
   ancora i dati vecchi — quindi il controllo vive anche qui, come per i rami FedWatch di v187.
   Ritorna i giorni di sovrapposizione, o null se le due serie non ne hanno. */
function sovrapposizioneGiorni(a, b) {
  const t = p => new Date(String(p.d).length <= 10 ? p.d + "T00:00:00" : p.d).getTime();
  const ok = x => (x || []).filter(p => p && p.d != null && p.v != null && !isNaN(t(p)));
  const A = ok(a), B = ok(b);
  if (A.length < 2 || B.length < 2) return null;
  const da = Math.max(Math.min(...A.map(t)), Math.min(...B.map(t)));
  const fino = Math.min(Math.max(...A.map(t)), Math.max(...B.map(t)));
  if (!(fino > da)) return null;
  const dentro = x => x.filter(p => t(p) >= da && t(p) <= fino).length;
  if (dentro(A) < 2 || dentro(B) < 2) return null;
  return Math.round((fino - da) / 86400000);
}

/* ⚠ v207 — QUESTO GRAFICO MENTIVA, ed è il difetto più grave trovato mappando la macro.
   L'ascissa era l'INDICE del punto: `px = i / (len - 1) * w`. Due serie con finestre temporali
   diverse venivano quindi STIRATE sulla stessa larghezza e lette come se fossero allineate.
   Casi reali misurati su data.json:
     · "Fed Funds vs S&P 500 — ultimi 5 anni": 60 punti MENSILI (2021-07→2026-06) sovrapposti a
       60 punti GIORNALIERI (2026-05-06→07-31). Cinque anni e tre mesi disegnati alla stessa
       lunghezza, uno sopra l'altro.
     · "Disaccoppiamento": 36 giorni di S&P contro 12 trimestri di PIL.
     · "Profitti reali": 3 mesi giornalieri contro 5 anni trimestrali.
   Il "gap" che questi grafici mostravano — il numero su cui poggia tutta la lettura — non
   corrispondeva a nessun confronto reale.

   Ora l'ascissa è il TEMPO, e il grafico si restringe alla FINESTRA COMUNE alle due serie:
   fuori da lì il confronto non esiste, e disegnarlo sarebbe di nuovo inventare un allineamento.
   Se la sovrapposizione è troppo corta per dire qualcosa, il grafico lo DICHIARA invece di
   disegnare una linea che sembra una tendenza. */
function miniDualChart(pts1, pts2, { w = 420, h = 80, color1 = "var(--blue)", color2 = "var(--green)", label1 = "A", label2 = "B" } = {}) {
  const val = (a) => (a || []).filter(p => p && p.v != null && p.d != null && !isNaN(new Date(p.d)));
  const A = val(pts1), B = val(pts2);
  if (A.length < 2 || B.length < 2) return '<div class="muted">Dati non disponibili</div>';
  const t = p => new Date(String(p.d).length <= 10 ? p.d + "T00:00:00" : p.d).getTime();
  const est = (a) => ({ da: Math.min(...a.map(t)), a: Math.max(...a.map(t)) });
  const eA = est(A), eB = est(B);
  const da = Math.max(eA.da, eB.da), fino = Math.min(eA.a, eB.a);
  const giorni = (ms) => Math.round(ms / 86400000);
  const span = (e) => giorni(e.a - e.da);
  if (!(fino > da)) {
    return `<div class="muted">Le due serie non si sovrappongono nel tempo (${label1}: ${dataBreve(new Date(eA.da).toISOString().slice(0, 10), true)}–${dataBreve(new Date(eA.a).toISOString().slice(0, 10), true)} · ${label2}: ${dataBreve(new Date(eB.da).toISOString().slice(0, 10), true)}–${dataBreve(new Date(eB.a).toISOString().slice(0, 10), true)}): un confronto non è calcolabile.</div>`;
  }
  const dentro = (a) => a.filter(p => t(p) >= da && t(p) <= fino);
  const A2 = dentro(A), B2 = dentro(B);
  if (A2.length < 2 || B2.length < 2) {
    return `<div class="muted">Nella finestra comune (${giorni(fino - da)} giorni) una delle due serie ha meno di due osservazioni: il confronto non è disegnabile.</div>`;
  }
  const all = [...A2, ...B2].map(p => p.v);
  const mn = Math.min(...all), mx = Math.max(...all), rng = mx - mn || 1;
  const px = p => (((t(p) - da) / (fino - da || 1)) * (w - 4) + 2).toFixed(1);
  const py = v => (h - 4 - (v - mn) / rng * (h - 8) + 2).toFixed(1);
  const poly = (pts) => pts.map(p => `${px(p)},${py(p.v)}`).join(" ");
  const b100 = mn <= 100 && 100 <= mx ? `<line x1="0" y1="${py(100)}" x2="${w}" y2="${py(100)}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 2"/>` : "";
  const uA = A2[A2.length - 1], uB = B2[B2.length - 1];
  const iso = ms => new Date(ms).toISOString().slice(0, 10);
  // la finestra comune è molto più corta dello storico che una delle due serie porta con sé:
  // dirlo, altrimenti si legge "cinque anni" un grafico che ne mostra tre mesi
  const tagliato = Math.max(span(eA), span(eB)) > giorni(fino - da) * 2;
  return `<div class="mini-chart-wrap">
    <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;display:block">${b100}
      <polyline points="${poly(B2)}" fill="none" stroke="${color2}" stroke-width="1.8"/>
      <polyline points="${poly(A2)}" fill="none" stroke="${color1}" stroke-width="2"/>
      <circle cx="${px(uA)}" cy="${py(uA.v)}" r="3" fill="${color1}"/>
      <circle cx="${px(uB)}" cy="${py(uB.v)}" r="3" fill="${color2}"/>
    </svg>
    <div class="mini-chart-legend"><span style="color:${color1}">—</span> ${label1} &nbsp; <span style="color:${color2}">—</span> ${label2}${mn <= 100 && 100 <= mx ? ' &nbsp; <span class="muted">— base 100</span>' : ""}</div>
    <div class="mini-chart-dates">${dataBreve(iso(da), true)} – ${dataBreve(iso(fino), true)} · finestra COMUNE alle due serie (${giorni(fino - da)} giorni, ${A2.length} e ${B2.length} osservazioni)${
      tagliato ? ` · <b>lo storico più lungo arriva a ${Math.max(span(eA), span(eB))} giorni ma fuori da questa finestra le due serie non sono confrontabili</b>` : ""}</div>
  </div>`;
}

// descrizione + cadenza pubblicazione (indicativa) per indicatore/box
const MACRO_INFO = {
  "in:cpi": ["Inflazione CPI (a/a)", "Indice prezzi al consumo USA. Sopra il target Fed del 2% alimenta pressioni sui tassi.", "Pubblicazione mensile, ~10–15 del mese (BLS)", /inflaz|inflation|\bcpi\b|prezzi/i],
  "in:pce": ["Inflazione PCE (a/a)", "Misura d'inflazione preferita dalla Fed.", "Mensile, fine mese (BEA)", /\bpce\b|inflaz|inflation/i],
  "in:gdp": ["PIL USA", "Crescita economica trimestrale annualizzata.", "Trimestrale (3 stime: anticipata, seconda, finale)", /\bpil\b|\bgdp\b|economia|economy|crescita/i],
  "in:retail": ["Vendite al dettaglio", "Spesa dei consumatori, indicatore di domanda.", "Mensile, ~metà mese (Census)", /vendite|retail|consum/i],
  "in:nfp": ["Non-Farm Payrolls", "Nuovi posti di lavoro USA, market mover sui tassi.", "Mensile, primo venerdì (BLS)", /payroll|lavoro|jobs|occupa/i],
  "in:unemp": ["Disoccupazione", "Tasso di disoccupazione USA.", "Mensile, primo venerdì (BLS)", /disoccupa|unemploy|jobs/i],
  "in:umich": ["Fiducia consumatori", "Sentiment delle famiglie USA (Univ. Michigan).", "Mensile (preliminare + finale)", /fiducia|sentiment|consumer|michigan/i],
  "in:curve": ["Curva 10A-2A", "Spread dei rendimenti; se negativo (inversione) storico segnale di recessione.", "Aggiornato in continuo", /curva|treasur|yield|recess|rendiment/i],
  "mk:^TNX": ["Treasury USA 10 anni", "Rendimento del decennale USA: sale = condizioni più restrittive.", "Mercato aperto USA", /treasur|10.?anni|yield|rendiment|bond/i],
  "mk:EURUSD=X": ["Cambio EUR/USD", "Euro contro dollaro: incide sul valore in € delle azioni USA.", "Continuo (forex)", /euro|dollar|eur.?usd|cambio|fx/i],
  "mk:EURJPY=X": ["Cambio EUR/JPY", "Euro contro yen.", "Continuo (forex)", /yen|jpy|euro|cambio/i],
  fear_greed: ["Fear & Greed Index", "Sentiment di mercato CNN: 0 paura estrema, 100 avidità estrema.", "Aggiornato giornalmente", /sentiment|fear|greed|paura|avidit|rally|selloff/i],
  vix: ["VIX — Volatilità", "Indice della volatilità attesa S&P500 (\"indice della paura\").", "Mercato aperto USA", /vix|volatil|selloff|panic|paura/i],
  credit: ["Rischio Credito (HY OAS)", "Spread dei bond high-yield vs Treasury (proxy CDS): allargamento = stress sul credito, storicamente anticipa le correzioni azionarie.", "Giornaliero (FRED)", /credit|spread|high.?yield|oas/i],
  liquidity: ["Liquidità in attesa — Istituzionali vs Retail", "PROXY dichiarati: quota AUM in T-Bill ETF (BIL+SHV) vs SPY per gli istituzionali; fondi monetari retail FRED RMFNS (livello, YoY, percentile 5A). Cash alto = benzina potenziale per i rialzi; in aumento = de-risking in corso.", "AUM: giornaliero · RMFNS: mensile", /liquidit|cash|money market|dry powder/i],
  dollar: ["Righello Dollaro (DXY 3M)", "Variazione trimestrale del Dollar Index: sopra +5% comprime gli utili esteri delle large cap USA ([FX HEADWIND] nelle tabelle); sotto -5% li gonfia ([FX TAILWIND]).", "Giornaliero", /dollar|dxy|valut|cambio/i],
  fedwatch: ["FedWatch", "Aspettative di mercato sui tassi Fed dai futures sui Fed Funds.", "Riunioni FOMC ~ogni 6 settimane", /fed|powell|tass|rate|fomc|interest/i],
  carry: ["Carry USA–Giappone", "Differenziale di rendimento USA-Giappone, motore del carry trade su USD/JPY.", "Continuo", /carry|yen|jpy|japan|giappone|boj/i],
  putcall: ["Put/Call ratio", "Rapporto opzioni put/call: alto = copertura/pessimismo.", "Mercato aperto USA", /option|put|call|hedge/i],
  yield_recession: ["Curva dei rendimenti & Recessione", "Analisi storica: lo spread 10A-2A rispetto alla crescita del PIL reale e alle recessioni USA (FRED).", "Mensile", /curva|yield|recess|pil|gdp|recession|inversione|irripid/i],
  systemic_risk: ["Rischio Sistemico & Credito", "Stress del mercato del credito (spread HY e IG, proxy CDS) come campanello d'allarme anticipato sull'azionario.", "Giornaliero", /credit|cds|spread|sistemic|systemic|stress|high.?yield|risk.?off/i],
  sentiment: ["Sentiment globale", "Indicatore composito risk-on/risk-off.", "Aggiornato a ogni refresh", /sentiment|risk|rally|selloff|market/i],
  buffett: ["Buffett Indicator", "Capitalizzazione totale del mercato USA rapportata al PIL: sopra ~150% storicamente indica sopravvalutazione.", "Aggiornato a ogni refresh", /valuation|buffett|overvalu|gdp|market cap|bolla|bubble/i],
  thermometer: ["Termometro portafoglio", "Media della salute tecnica (RSI, trend, momentum) dei tuoi titoli.", "Aggiornato a ogni refresh", /(?!)/],
  credit: ["Rischio Credito (HY OAS)", "Spread dei bond High Yield rispetto ai Treasury USA: proxy del rischio sistemico, analogo al mercato CDS senza costi di abbonamento. Fonte: ICE BofA via FRED.", "Giornaliero (FRED)", /credit|credito|spread|hy|high.?yield|cds|default|obbligaz|bond/i],
  decouple: ["Disaccoppiamento Macro", "Divergenza tra mercato azionario (S&P 500) e economia reale (PIL reale USA GDPC1): misura quanta crescita futura è già prezzata nella borsa. Entrambe le serie normalizzate a 100 all'inizio del periodo.", "Mensile/trimestrale (FRED)", /disaccopp|decoupl|valuation|bolla|bubble|pil|gdp|utili|profit|crescita/i],
  smart_money: ["Istituzionali VS Retail", "Posizionamento istituzionale (SMC) vs folla retail (Fear & Greed) — divergenze estreme segnalano accumulo o distribuzione.", "Aggiornato a ogni refresh", /smart.?money|istituzional|institution|retail|hedge.?fund|posizionament|flow|flussi|put.?call|vix|smc|order.?block|liquidit|struttura/i],
  sp500_pe: ["P/E Ratio Storico S&P 500", "Rapporto Prezzo/Utili dell'S&P 500 su base mensile (FRED SP500PE). Mostra se il mercato è sopravvalutato rispetto alla media storica. P/E > 25 indica valutazioni tese; P/E > 35 livelli estremi. La percentile di rango storico indica quante volte negli ultimi 10 anni il mercato è stato più economico di adesso.", "Mensile (FRED SP500PE)", /p\/e|price.?earning|multiplo|valutaz|sopravvalut|cape|shiller/i],
  corp_profit: ["S&P 500 & Nasdaq 100 vs Profitti Reali", "Divergenza tra S&P 500 e Nasdaq 100 nominali e i profitti aziendali reali USA (FRED CP). Gap ampio = Asset Inflation da fiat debasement, non crescita utili reali. Storico: gap >40 pp precede correzioni o lateralizzazioni.", "Trimestrale (FRED CP + SP500/NDX mensile)", /profitti|profit|asset.?inflat|nominal|real.?earn|corp|aziend|deflat|nasdaq/i],
  fed_market: ["Fed Funds Rate vs S&P 500", "Andamento storico del tasso Fed Funds sovrapposto all'S&P 500 negli ultimi 5 anni. Mostra come i cicli di rialzo/taglio della politica monetaria influenzino il mercato azionario. Tassi alti comprimono i multipli; i tagli stimolano i rally.", "Mensile (FRED FEDFUNDS + SP500)", /fed.?fund|interest.?rate|tasso.?fed|fed.?rate|monetar|fomc.*trend|tassi.*mercato/i],
};

/* ═══ v188 — POPUP UNIFICATI (richiesta CEO): un solo pannello per titolo, uno solo per la macro.
   Il trucco che evita di riscrivere 17 funzioni: TUTTE finiscono in openInfoModal(titolo, html).
   Si sostituisce temporaneamente quella funzione con un raccoglitore, si eseguono le funzioni
   esistenti e si tiene il loro HTML. Ogni pannello resta l'unica fonte di verità del suo
   contenuto — se domani cambia openMarginDebtModal, la pagina unica cambia con lei. */
/* ═══ SCHEDA UNICA DEL TITOLO (v188) — si apre cliccando il NOME del titolo.
   Prima i dati di un titolo erano sparsi in cinque popup diversi, ciascuno raggiungibile solo
   cliccando la cella giusta: forza relativa sulla cella RS, Sharpe sulla cella Sharpe, conto
   economico sulla riga fondamentale, opzioni sulla cella opzioni. Con le colonne nascondibili
   quelle celle possono non esserci più — e con loro sparirebbe l'accesso al dato. Un solo
   punto d'ingresso, il nome, che raccoglie tutto. */
function openStockCard(ticker) {
  const all = [...(DATA.portfolio || []), ...(DATA.watchlist || [])];
  const r = all.find(x => x.ticker === ticker);
  if (!r) return;
  const panels = collectPanels([
    { label: "Scheda — tecnica, prezzi e fondamentali", run: () => openStockDetail(ticker) },
    { label: "Forza relativa (RS) — come si legge",     run: () => openRsInfo(ticker) },
    { label: "Sharpe Ratio — come si legge",            run: () => openSharpeInfo(ticker) },
    { label: "Conto economico e statistiche",           run: () => openFinancialsModal(ticker) },
    { label: "Trimestrale e movimento implicito",       run: () => (r.earnings_date ? openEarningsInfo(ticker) : null) },
  ]);
  const tv = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol(r))}`;
  const azioni = `<div class="pp-actions">
      <button class="btn btn-ghost btn-sm" data-card-chart="${esc(r.ticker)}">📈 Grafico</button>
      ${hasOptions(r.ticker) ? `<button class="btn btn-ghost btn-sm" data-card-opt="${esc(r.ticker)}">⛓ Catena opzioni</button>` : ""}
      <a class="btn btn-ghost btn-sm" href="${tv}" target="_blank" rel="noopener">TradingView ↗</a>
    </div>`;
  PANEL_LAST_TICKER = ticker;
  renderPanelPage(`${r.name} (${r.ticker})`, panels, "Nessun dettaglio disponibile per questo titolo.", "titolo");
  // le azioni vanno in cima, sotto il titolo: sono le due viste che NON sono testo
  const nav = document.querySelector("#chart-modal-body .pp-nav");
  if (nav) nav.insertAdjacentHTML("afterbegin", azioni);
}

/* ═══ DETTAGLI MACRO IN UNA PAGINA SOLA (v188) — bottone "Dettagli macro".
   Stessa ragione: i sette riquadri e le voci della griglia macro aprivano ciascuno il suo popup.
   Ora c'è un indice in cima e si scorre. Le mini-card restano cliccabili per chi vuole il
   singolo dettaglio: questo aggiunge una via d'accesso, non ne toglie. */
function openMacroDetails() {
  const m = (DATA && DATA.macro) || {};
  // v193 — TOLTI DUE PANNELLI (richiesta CEO). "Analisi della rotazione" ripeteva la stessa
  // classifica settoriale di "Rotazione settoriale" con parole diverse; "Salute del portafoglio"
  // era un punteggio composito i cui tre addendi (tecnica, macro, fondamentale) hanno gia'
  // ciascuno il proprio pannello. Restano raggiungibili dalle mini-card se servono.
  const tasks = [
    { label: "MacroQuant — ciclo economico",        run: openMacroQuantModal, dom: "#macroquant-box" },
    { label: "BofA Bear-Market Signposts",          run: openSignpostsModal, dom: "#signposts-box" },
    { label: "Rotazione settoriale",                run: openTiltModal, dom: "#tilt-box" },

    { label: "Stagionalità",                        run: openSeasonalityModal, dom: "#seasonality-box" },
    { label: "Sharpe del portafoglio",              run: openPortfolioSharpeModal, dom: "#sharpe-box" },
    { label: "Alpha del processo",                  run: openAlphaModal },
    { label: "Rischio cambio EUR/USD",              run: openFxModal, dom: "#fx-box" },
    { label: "Margin Debt — leva a credito",        run: openMarginDebtModal, dom: "#margin-debt-box" },

  ];
  // + una sezione per ogni voce della griglia macro che ha un dettaglio proprio. Le chiavi si
  // leggono da MACRO_INFO, che e' gia' il registro di quei pannelli: nessun secondo elenco da
  // tenere allineato (la classe di difetto che ha prodotto C10 e C12).
  for (const k of Object.keys(MACRO_INFO || {}))
    tasks.push({ label: null, run: () => openMacroInfo(k), dom: `[data-macro="${CSS.escape(k)}"]` });
  const pannelli = collectPanels(tasks);
  PANEL_DOM.clear();
  for (const p of pannelli) if (p.dom) PANEL_DOM.set(p.title, p.dom);
  renderPanelPage("Dettagli macro", pannelli, "Dati macro non ancora caricati.", "macro");
}

function collectPanels(tasks) {
  const out = [];
  const orig = openInfoModal;
  openInfoModal = (title, bodyHTML) => out.push({ title, bodyHTML });
  try {
    for (const t of tasks) {
      const prima = out.length;
      try { t.run(); } catch (e) { /* un pannello rotto non deve far cadere la pagina intera */ }
      // se la funzione non ha aperto nulla (dato assente) si salta: niente sezioni vuote
      for (let i = prima; i < out.length; i++) {
        if (t.label) out[i].title = t.label;
        if (t.dom) out[i].dom = t.dom;      // v196: l'aggancio alla dashboard e' DICHIARATO qui
      }
    }
  } finally { openInfoModal = orig; }
  return out;
}
/* rende i pannelli raccolti in una pagina MAESTRO-DETTAGLIO: indice a sinistra (riordinabile
   per trascinamento), contenuto a destra in un riquadro ampio. v190, richiesta CEO.
   L'ordine si persiste per "ambito" (macro / titolo) e — dove esiste una corrispondenza — si
   propaga alla dashboard: le voci macro che hanno una mini-card la spostano con sé. Per le
   sezioni della scheda titolo NON esiste un elenco corrispondente nella dashboard, quindi lì
   l'ordine vale solo dentro il popup: dirlo è meglio che fingere una propagazione che non c'è. */
const panelOrderKey = (ambito) => `panelorder_${ambito}`;
function loadPanelOrder(ambito) {
  try { const a = JSON.parse(localStorage.getItem(panelOrderKey(ambito)) || "null"); return Array.isArray(a) ? a : null; }
  catch { return null; }
}
function savePanelOrder(ambito, titoli) {
  try { localStorage.setItem(panelOrderKey(ambito), JSON.stringify(titoli)); } catch { /* quota */ }
}
/* ordina i pannelli secondo la preferenza salvata; i nuovi (non ancora in elenco) restano in coda
   nell'ordine originale, così un pannello aggiunto in futuro non sparisce né va a caso */
function ordinaPannelli(ambito, panels) {
  const pref = loadPanelOrder(ambito);
  if (!pref) return panels;
  const pos = new Map(pref.map((t, i) => [t, i]));
  return panels.slice().sort((a, b) => (pos.has(a.title) ? pos.get(a.title) : 1e6) - (pos.has(b.title) ? pos.get(b.title) : 1e6));
}
/* le voci macro che hanno una mini-card nella dashboard: riordinare nel popup riordina anche quelle */
const MACRO_CARD_BY_PANEL = {
  "MacroQuant — ciclo economico": "macroquant-box",
  "BofA Bear-Market Signposts": "signposts-box",
  "Rotazione settoriale": "tilt-box",
  "Stagionalità": "seasonality-box",
  "Sharpe del portafoglio": "sharpe-box",
  "Rischio cambio EUR/USD": "fx-box",
  "Margin Debt — leva a credito": "margin-debt-box",
};
/* v196 — L'ORDINE VALE SU TUTTA LA SEZIONE MACRO, non solo sulle sette mini-card.
   Il CEO riordinava il popup e la dashboard non seguiva. La causa: la propagazione conosceva
   solo MACRO_CARD_BY_PANEL, cioe' 7 pannelli su 37 — ma le voci "Inflazione CPI", "PIL USA",
   "Curva 10A-2A" e compagnia HANNO un corrispondente in dashboard: sono i `.macro-item` della
   griglia, con `data-macro="in:cpi"` e simili. Erano 23 gli elementi riordinabili e ne muovevo 7.
   La mappa dei `.macro-item` si ricava da MACRO_INFO, che e' gia' il registro dei loro titoli:
   nessun secondo elenco da tenere allineato. */
/* v196b — L'AGGANCIO NON SI INDOVINA DAL TITOLO. Prima si cercava in MACRO_INFO la voce il cui
   nome coincidesse col titolo del pannello: per una parte (Fiducia consumatori, VIX, FedWatch…)
   non coincideva, quelle voci restavano ferme in cima e la griglia sembrava non seguire affatto
   l'ordine. Ora ogni pannello DICHIARA il proprio selettore quando viene raccolto, e la mappa si
   costruisce da li'. Accoppiare due cose per il loro nome visibile e' fragile per costruzione:
   il nome e' fatto per essere letto, non per essere una chiave. */
const PANEL_DOM = new Map();
function elementoDashboardPerPannello(titolo) {
  const sel = PANEL_DOM.get(titolo);
  return sel ? document.querySelector(sel) : null;
}
function applicaOrdineMacro() {
  const pref = loadPanelOrder("macro");
  if (!pref) return;
  // Ogni elemento si riordina DENTRO IL PROPRIO genitore: due voci in contenitori diversi non
  // si mescolano, e non serve sapere in anticipo quali siano i contenitori. L'elenco scritto a
  // mano (.mini-cards, #macro-grid) lasciava fermo tutto cio' che vive altrove — ed e' lo stesso
  // difetto dei registri fissi gia' pagato con C10 e con gli indici del red team.
  const perGenitore = new Map();
  for (const titolo of pref) {
    const el = elementoDashboardPerPannello(titolo);
    if (!el || !el.parentElement) continue;
    if (!perGenitore.has(el.parentElement)) perGenitore.set(el.parentElement, []);
    perGenitore.get(el.parentElement).push(el);
  }
  for (const [cont, elems] of perGenitore) for (const el of elems) cont.appendChild(el);
}
/* nome storico mantenuto: era chiamato da piu' punti e da un handler */
const applicaOrdineMiniCard = applicaOrdineMacro;
function renderPanelPage(titolo, panels, notaVuota, ambito) {
  if (!panels.length) { openInfoModal(titolo, `<div class="muted" style="font-size:12px">${notaVuota || "Nessun dettaglio disponibile."}</div>`); return; }
  const ord = ambito ? ordinaPannelli(ambito, panels) : panels;
  // v193 — SU IPHONE IL TRASCINAMENTO NON ESISTE. L'HTML5 drag-and-drop non e' supportato da
  // Safari su touch: il CEO trascinava e non succedeva nulla, e la dashboard "non si allineava"
  // semplicemente perche' l'ordine non era mai cambiato. Le frecce funzionano ovunque — mouse,
  // tastiera e dito — e il trascinamento resta come scorciatoia per chi e' al computer.
  const voci = ord.map((p, i) =>
    `<li class="pp-nav-item${i === 0 ? " is-active" : ""}" draggable="true" data-idx="${i}" title="${esc(p.title)}">
       <span class="pp-nav-txt">${esc(p.title)}${ambito === "macro" && !elementoDashboardPerPannello(p.title) ? ' <em class="pp-solo-popup" title="Questa voce non ha un riquadro corrispondente nella dashboard: spostarla cambia solo l\'ordine qui dentro">solo qui</em>' : ""}</span>
       <span class="pp-move">
         <button class="pp-mv" data-mv="up" data-i="${i}" ${i === 0 ? "disabled" : ""} aria-label="Sposta ${esc(p.title)} in su" title="Sposta in su">▲</button>
         <button class="pp-mv" data-mv="down" data-i="${i}" ${i === ord.length - 1 ? "disabled" : ""} aria-label="Sposta ${esc(p.title)} in giù" title="Sposta in giù">▼</button>
       </span></li>`).join("");
  const corpi = ord.map((p, i) =>
    `<section class="pp-pane${i === 0 ? " is-active" : ""}" data-pane="${i}">
       <h3 class="pp-h">${esc(p.title)}</h3>${p.bodyHTML}</section>`).join("");
  const nota = ambito === "macro"
    ? `<div class="pp-nav-note muted">Trascina per riordinare: l'ordine si applica anche alle schede macro della dashboard.</div>`
    : ambito ? `<div class="pp-nav-note muted">Trascina per riordinare le sezioni di questa scheda.</div>` : "";
  openInfoModal(titolo, `<div class="pp-split" data-ambito="${esc(ambito || "")}">
      <nav class="pp-nav"><ul class="pp-nav-list">${voci}</ul>${nota}</nav>
      <div class="pp-detail">${corpi}</div>
    </div>`);
  wirePanelPage(ord.map(p => p.title), ambito);
}
/* selezione + trascinamento nell'indice */
function wirePanelPage(titoli, ambito) {
  const root = document.querySelector("#chart-modal-body .pp-split");
  if (!root) return;
  const mostra = (i) => {
    root.querySelectorAll(".pp-nav-item").forEach(el => el.classList.toggle("is-active", Number(el.dataset.idx) === i));
    root.querySelectorAll(".pp-pane").forEach(el => el.classList.toggle("is-active", Number(el.dataset.pane) === i));
    const d = root.querySelector(".pp-detail"); if (d) d.scrollTop = 0;
  };
  root.querySelector(".pp-nav-list")?.addEventListener("click", (e) => {
    const mv = e.target.closest(".pp-mv");
    if (mv) {                                    // freccia: sposta di una posizione
      e.stopPropagation();
      if (!ambito) return;
      const i = Number(mv.dataset.i), j = mv.dataset.mv === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= titoli.length) return;
      const nuovo = titoli.slice();
      [nuovo[i], nuovo[j]] = [nuovo[j], nuovo[i]];
      applicaNuovoOrdine(ambito, nuovo, j);
      return;
    }
    const it = e.target.closest(".pp-nav-item"); if (it) mostra(Number(it.dataset.idx));
  });
  if (!ambito) return;
  let from = null;
  const lista = root.querySelector(".pp-nav-list");
  lista?.addEventListener("dragstart", (e) => {
    const it = e.target.closest(".pp-nav-item"); if (!it) return;
    from = Number(it.dataset.idx); it.classList.add("pp-dragging"); e.dataTransfer.effectAllowed = "move";
  });
  lista?.addEventListener("dragend", (e) => {
    e.target.closest(".pp-nav-item")?.classList.remove("pp-dragging");
    lista.querySelectorAll(".pp-nav-item").forEach(x => x.classList.remove("pp-over"));
  });
  lista?.addEventListener("dragover", (e) => {
    e.preventDefault();
    const it = e.target.closest(".pp-nav-item"); if (!it) return;
    lista.querySelectorAll(".pp-nav-item").forEach(x => x.classList.toggle("pp-over", x === it));
  });
  lista?.addEventListener("drop", (e) => {
    e.preventDefault();
    const it = e.target.closest(".pp-nav-item"); if (!it || from == null) return;
    const to = Number(it.dataset.idx);
    if (from === to) return;
    const nuovo = titoli.slice();
    nuovo.splice(to, 0, ...nuovo.splice(from, 1));
    applicaNuovoOrdine(ambito, nuovo, to);
  });
}
/* UNA sola strada per applicare un nuovo ordine, usata sia dalle frecce sia dal trascinamento:
   due percorsi separati avrebbero potuto divergere, ed e' la classe di difetto che questo
   progetto ha gia' pagato piu' volte. */
function applicaNuovoOrdine(ambito, nuovoOrdine, indiceDaMostrare) {
  savePanelOrder(ambito, nuovoOrdine);
  if (ambito === "macro") applicaOrdineMiniCard();
  if (ambito === "macro") openMacroDetails(); else if (PANEL_LAST_TICKER) openStockCard(PANEL_LAST_TICKER);
  // si resta sulla voce appena spostata, altrimenti a ogni clic si torna in cima
  const root = document.querySelector("#chart-modal-body .pp-split");
  const it = root?.querySelector(`.pp-nav-item[data-idx="${indiceDaMostrare}"]`);
  if (it) it.click();
  toast("Ordine aggiornato" + (ambito === "macro" ? " — anche nelle schede macro della dashboard" : ""));
}
let PANEL_LAST_TICKER = null;

function openInfoModal(title, bodyHTML) {
  $("#chart-modal-title").textContent = title;
  $("#chart-modal-body").innerHTML = bodyHTML;
  $("#chart-modal-tip").innerHTML = "";
  $("#chart-modal").hidden = false;
}

// data stimata della prossima pubblicazione (calendario tipico USA)
function nextReleaseDate(key) {
  const now = new Date(), fmt = d => d.toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
  const firstFriday = (y, mth) => { const d = new Date(y, mth, 1); while (d.getDay() !== 5) d.setDate(d.getDate() + 1); return d; };
  const nextMonthDay = day => { let d = new Date(now.getFullYear(), now.getMonth(), day); if (d <= now) d = new Date(now.getFullYear(), now.getMonth() + 1, day); return d; };
  if (key === "nfp" || key === "unemp") {        // primo venerdì del mese
    let d = firstFriday(now.getFullYear(), now.getMonth()); if (d <= now) d = firstFriday(now.getFullYear(), now.getMonth() + 1); return fmt(d);
  }
  if (key === "cpi") return fmt(nextMonthDay(12));
  if (key === "pce") return fmt(nextMonthDay(28));
  if (key === "retail") return fmt(nextMonthDay(16));
  if (key === "pmi") return fmt(nextMonthDay(27));
  return null;   // gdp/curve: continui o trimestrali variabili
}

/* grafico macro: curva dei rendimenti vs PIL con bande di recessione (grigie) + doppio asse Y.
   shiftMonths>0 sposta la curva in avanti (es. +12 mesi) per evidenziare il lead/lag col PIL. */
function recessionChart(curveArr, gdpArr, recessions, opts = {}) {
  const shiftMs = (opts.shiftMonths || 0) * 30.44 * 864e5;
  const C = (curveArr || []).map(p => ({ t: +new Date(p.d + "T00:00:00") + shiftMs, v: p.v })).filter(p => !isNaN(p.t) && p.v != null);
  const G = (gdpArr || []).map(p => ({ t: +new Date(p.d + "T00:00:00"), v: p.v })).filter(p => !isNaN(p.t) && p.v != null);
  if (C.length < 2 || G.length < 2) return '<div class="muted">Dati storici non disponibili</div>';
  const W = 640, H = 230, pad = { l: 40, r: 44, t: 14, b: 24 };
  const minT = Math.min(...C.concat(G).map(p => p.t)), maxT = Math.max(...C.concat(G).map(p => p.t));
  const x = t => pad.l + (t - minT) / (maxT - minT || 1) * (W - pad.l - pad.r);
  const cMin = Math.min(...C.map(p => p.v), 0), cMax = Math.max(...C.map(p => p.v), 0), cR = (cMax - cMin) || 1;
  const gMin = Math.min(...G.map(p => p.v), 0), gMax = Math.max(...G.map(p => p.v), 0), gR = (gMax - gMin) || 1;
  const yC = v => pad.t + (1 - (v - cMin) / cR) * (H - pad.t - pad.b);
  const yG = v => pad.t + (1 - (v - gMin) / gR) * (H - pad.t - pad.b);
  const bands = (recessions || []).map(r => {
    const x1 = x(+new Date(r.start + "T00:00:00")), x2 = x(+new Date(r.end + "T00:00:00"));
    const xa = Math.max(pad.l, x1), xb = Math.min(W - pad.r, x2);
    return (xb <= pad.l || xa >= W - pad.r) ? "" : `<rect x="${xa.toFixed(1)}" y="${pad.t}" width="${Math.max(0.5, xb - xa).toFixed(1)}" height="${(H - pad.t - pad.b).toFixed(1)}" fill="var(--muted)" opacity="0.2"/>`;
  }).join("");
  const poly = (arr, y) => arr.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const years = [];
  const y0 = new Date(minT).getFullYear(), y1 = new Date(maxT).getFullYear();
  const step = Math.ceil((y1 - y0) / 6) || 1;
  for (let yy = Math.ceil(y0 / step) * step; yy <= y1; yy += step) {
    const tx = x(+new Date(`${yy}-01-01T00:00:00`));
    years.push(`<text x="${tx.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="var(--muted)">${yy}</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    ${bands}
    <line x1="${pad.l}" y1="${yC(0).toFixed(1)}" x2="${W - pad.r}" y2="${yC(0).toFixed(1)}" stroke="var(--border)" stroke-dasharray="3 3"/>
    <polyline points="${poly(C, yC)}" fill="none" stroke="var(--blue)" stroke-width="1.8"/>
    <polyline points="${poly(G, yG)}" fill="none" stroke="var(--green)" stroke-width="1.8"/>
    <text x="2" y="${(pad.t + 6).toFixed(1)}" font-size="9" fill="var(--blue)">${fmtNum.format(Math.round(cMax * 10) / 10)}</text>
    <text x="2" y="${(H - pad.b).toFixed(1)}" font-size="9" fill="var(--blue)">${fmtNum.format(Math.round(cMin * 10) / 10)}</text>
    <text x="${W - pad.r + 4}" y="${(pad.t + 6).toFixed(1)}" font-size="9" fill="var(--green)">${fmtNum.format(Math.round(gMax))}%</text>
    <text x="${W - pad.r + 4}" y="${(H - pad.b).toFixed(1)}" font-size="9" fill="var(--green)">${fmtNum.format(Math.round(gMin))}%</text>
    ${years.join("")}
  </svg>
  <div class="rec-leg"><span><span class="dot" style="background:var(--blue)"></span>Curva 10A-2A${opts.shiftMonths ? ` (+${opts.shiftMonths}m)` : ""} <span class="muted">(asse sx, pp)</span></span>
    <span><span class="dot" style="background:var(--green)"></span>PIL reale YoY <span class="muted">(asse dx, %)</span></span>
    <span><span class="dot" style="background:var(--muted)"></span>Recessioni</span></div>`;
}

function openMacroInfo(key) {
  const info = MACRO_INFO[key];
  if (!info) return;
  const [name, desc, cadence, rx] = info;
  const m = DATA.macro || {};
  let extra = "";

  // valore attuale + data + sentiment per gli indicatori macro
  if (key.startsWith("in:")) {
    const ind = (m.indicators || []).find(i => "in:" + i.key === key);
    if (ind) {
      const sent = ind.impact >= 60 ? '<span class="pos">favorevole ai mercati</span>'
        : ind.impact <= 40 ? '<span class="neg">sfavorevole ai mercati</span>' : "neutro";
      const nd = nextReleaseDate(ind.key);
      extra = `<div class="info-line"><b>Valore attuale:</b> ${ind.value} <span class="muted">(${ind.date})</span></div>
        <div class="info-line"><b>Impatto:</b> ${sent}</div>
        ${nd ? `<div class="info-line"><b>Prossima pubblicazione stimata:</b> ${nd}</div>` : ""}
        ${ind.next_release ? `<div class="info-line muted">${ind.next_release}</div>` : ""}`;
    }
  } else if (key === "fedwatch" && m.fedwatch) {
    const fw = m.fedwatch;
    // v207 — la colonna RIALZO mancava: il popup mostrava "Taglio" e "Invariato" mentre i dati
    // portavano hike_prob al 2% e al 26%. È la classe C14 (una probabilita' pubblicata a zero su
    // una sola direzione e' informazione mancante travestita da informazione presente), corretta
    // nel payload in v187 e sopravvissuta qui per due versioni.
    const primo = ramiFedWatch(fw, (fw.meetings || [])[0]);
    extra = `<div class="info-line"><b>Range attuale:</b> ${fw.target_range} · implicito ${fmtNum.format(fw.implied_rate)}%</div>
      <div class="info-line"><b>Prossima riunione:</b> <span class="neg">rialzo ${primo.hike_prob ?? 0}%</span> · invariato ${primo.hold_prob ?? 0}% · <span class="pos">taglio ${primo.cut_prob ?? 0}%</span></div>`;
    if ((fw.meetings || []).length) {
      extra += `<table class="info-table"><thead><tr><th>Riunione FOMC</th><th>Rialzo</th><th>Invariato</th><th>Taglio</th></tr></thead><tbody>`
        + fw.meetings.map(x => { const r = ramiFedWatch(fw, x); return `<tr><td>${new Date(r.date).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}</td>
          <td class="neg">${r.hike_prob ?? 0}%</td><td>${r.hold_prob ?? 0}%</td><td class="pos">${r.cut_prob ?? 0}%</td></tr>`; }).join("")
        + `</tbody></table><div class="info-line muted" style="font-size:11px">Probabilità stimate dai futures sui Fed Funds (stile CME FedWatch). Tutti e tre i rami sono sempre mostrati, anche a zero: uno zero esplicito è informazione, l'assenza della voce no.</div>`;
    }
    if ((fw.dot_plot || []).length) {            // Dot Plot: mediana proiezioni FOMC
      const mx = Math.max(...fw.dot_plot.map(d => d.median));
      extra += `<h4 style="margin:12px 0 4px">Dot Plot — mediana proiezioni FOMC</h4>
        <div class="dotplot">` + fw.dot_plot.map(d =>
        `<div class="dp-col"><div class="dp-bar-wrap"><div class="dp-bar" style="height:${Math.round(d.median / mx * 100)}%"></div></div>
           <div class="dp-val">${fmtNum.format(d.median)}%</div><div class="dp-year">${d.year}</div></div>`).join("")
        + `</div><div class="info-line muted" style="font-size:11px">${esc(fw.dot_plot_note || "")}</div>`;
    }
  } else if (key === "fear_greed" && m.fear_greed) {
    const fg = m.fear_greed;
    extra = `<div class="info-line"><b>Oggi:</b> ${fg.score} (${FG_LABELS[fg.rating] || fg.rating}) · 1 sett ${fg.week_ago} · 1 mese ${fg.month_ago}${fg.year_ago ? ` · 1 anno ${fg.year_ago}` : ""}</div>`;
    if (fg.fomo != null) {
      extra += `<div class="info-line"><b>FOMO:</b> <span style="color:${scoreColor(100 - fg.fomo)}">${fg.fomo}/100 — ${fg.fomo_label}</span></div>
        ${meterBar(fg.fomo, scoreColor(100 - fg.fomo), fg.fomo + "")}
        <div class="info-line muted" style="font-size:11px">Indice derivato (avidità + momentum S&P 500): alto = rischio di inseguire il rialzo.</div>`;
    }
    if ((fg.components || []).length) {
      extra += `<h4 style="margin:10px 0 4px">I 7 componenti</h4>` + fg.components.map(c =>
        `<div class="info-line" style="display:flex;justify-content:space-between"><span>${c.label}</span><span class="muted">${c.rating}${c.score != null ? ` (${c.score})` : ""}</span></div>`).join("");
    }
  } else if (key === "carry" && m.carry) {
    const cy = m.carry;
    // regime del carry trade in base allo spread dei tassi 10A
    const regime = cy.spread >= 3 ? { txt: "Carry molto favorevole — differenziale ampio, flussi verso USD", cls: "pos" }
      : cy.spread >= 2.2 ? { txt: "Carry favorevole — differenziale solido", cls: "pos" }
      : cy.spread >= 1.5 ? { txt: "Carry in compressione — margine in calo, sorvegliare l'unwind", cls: "" }
      : { txt: "Carry a rischio — differenziale stretto, possibile rientro di capitali in yen", cls: "neg" };
    // aspettativa BoJ per ogni meeting, basata su spread corrente + trend yen (yen forte ⇒ più pressione al rialzo)
    const bojExpect = (sp) => {
      if (sp < 1.2) return { txt: "Rialzo probabile — spread stretto, mercati prezzano stretta BoJ", cls: "neg" };
      if (sp < 1.8) return { txt: "Possibile rialzo — BoJ hawkish, sorvegliare inflazione JP e yen", cls: "neg" };
      if (sp < 2.4) return { txt: "Fermi con bias hawkish — compressione in corso, rischio unwind", cls: "" };
      if (sp < 3.0) return { txt: "Probabilmente fermi — spread sufficiente a sostenere il carry", cls: "" };
      return { txt: "Fermi o taglio remoto — spread ampio, carry molto conveniente", cls: "pos" };
    };
    const carryScore = clamp((cy.spread - 0.5) / 3 * 100);
    const yenTrend = cy.usdjpy_chg_1m > 0 ? "yen in indebolimento (favorevole al carry)" : "yen in rafforzamento (attenzione all'unwind)";
    extra = `<div class="info-line muted" style="font-size:11.5px;margin-bottom:8px">
        Il <b>carry trade USD/JPY</b>: ci si finanzia in yen a tasso quasi zero per investire in asset in dollari a tasso più alto. Più ampio è il differenziale dei tassi (e più debole lo yen), più è redditizio. Un rialzo BoJ o uno yen che si rafforza comprime il margine e può innescare un <b>unwind</b> rapido: vendite forzate sugli azionari globali e rientro di capitali in yen (come ad agosto 2024).
      </div>
      <div class="info-line"><b>Treasury 10A (USA):</b> ${fmtNum.format(cy.us10)}% &nbsp;·&nbsp; <b>JGB 10A (Giappone):</b> ${fmtNum.format(cy.jp10)}%</div>
      <div class="info-line"><b>Differenziale tassi 10A (USA−Giappone):</b> <span style="color:${scoreColor(carryScore)}">${fmtNum.format(cy.spread)} pp</span> — <span class="${regime.cls}">${regime.txt}</span></div>
      ${cy.boj_rate != null ? `<div class="info-line"><b>Tasso ufficiale BoJ (overnight call rate):</b> ${fmtNum.format(cy.boj_rate)}%</div>` : ""}
      <div class="info-line"><b>Cambio USD/JPY:</b> ${fmtNum.format(cy.usdjpy)} <span class="${signCls(cy.usdjpy_chg_1m)}">(${signTxt(cy.usdjpy_chg_1m)} nell'ultimo mese)</span> — ${yenTrend}</div>
      ${thermoBar(carryScore, ["Carry favorevole", "Carry a rischio"])}
      <div class="info-line" style="margin:8px 0">${cy.note || ""}</div>`;
    if ((cy.boj_meetings || []).length) {
      const fmtMeet = (d) => new Date(d + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
      const next = cy.boj_meetings[0];
      const daysTo = Math.round((new Date(next + "T00:00:00") - new Date()) / 864e5);
      extra += `<h4 style="margin:12px 0 4px">Prossime riunioni Bank of Japan (decisione sui tassi)</h4>
        <div class="info-line"><b>Prossima:</b> ${fmtMeet(next)} <span class="muted">(tra ${daysTo} gg)</span></div>
        <table class="info-table"><thead><tr><th>Data riunione</th><th>Scenario atteso (modello interno)</th></tr></thead><tbody>`
        + cy.boj_meetings.map((d, i) => {
            const e = bojExpect(cy.spread - i * 0.05);   // più avanti nel tempo = più incertezza di stretta
            const est = d >= "2027-01-01" ? ' <span class="muted">(data stimata)</span>' : "";
            return `<tr><td>${fmtMeet(d)}${est}</td><td class="${e.cls}">${e.txt}</td></tr>`;
          }).join("")
        + `</tbody></table>
        <div class="info-line muted" style="font-size:11px;margin-top:6px">
          Calendario ufficiale BoJ 2026 (le date 2027 sono indicative e vanno confermate). Gli scenari sono un'euristica basata sul differenziale corrente, non previsioni ufficiali: un differenziale stretto aumenta la probabilità che il mercato prezzi una stretta BoJ.
        </div>`;
    }
  } else if (key === "putcall" && m.putcall) {
    const pc = m.putcall;
    const total = (pc.puts || 0) + (pc.calls || 0);
    const putPct = total ? Math.round(pc.puts / total * 100) : 50;
    const callPct = 100 - putPct;
    const bias = pc.ratio > 1.1 ? { txt: "Prevalgono le PUT — copertura/pessimismo (spesso difensivo o, agli estremi, contrarian rialzista)", cls: "neg" }
      : pc.ratio < 0.7 ? { txt: "Prevalgono le CALL — euforia/compiacenza (agli estremi, contrarian ribassista)", cls: "pos" }
      : { txt: "Flussi equilibrati tra put e call", cls: "" };
    extra = `<div class="info-line muted" style="font-size:11.5px;margin-bottom:8px">
        Il <b>Put/Call ratio</b> misura il volume di opzioni put diviso quello delle call su ${esc(pc.name || pc.symbol)}. >1 = più put (copertura/ribasso); &lt;1 = più call (rialzo). È un indicatore di sentiment, spesso letto in chiave <b>contrarian</b> agli estremi.
      </div>
      <div class="info-line"><b>Ratio:</b> <span style="color:${scoreColor(clamp(100 - pc.ratio / 2 * 100))};font-family:var(--mono);font-weight:700">${fmtNum.format(pc.ratio)}</span> — <span class="${bias.cls}">${bias.txt}</span></div>
      <h4 style="margin:12px 0 6px">Ripartizione del volume opzioni</h4>
      <div class="pc-split" role="img" aria-label="Ripartizione call ${callPct}% put ${putPct}%">
        <div class="pc-seg pc-call" style="width:${callPct}%">${callPct >= 12 ? "CALL " + callPct + "%" : ""}</div>
        <div class="pc-seg pc-put" style="width:${putPct}%">${putPct >= 12 ? "PUT " + putPct + "%" : ""}</div>
      </div>
      <div class="info-line" style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:12px;margin-top:6px">
        <span style="color:var(--green)">CALL ${pc.calls.toLocaleString("it-IT")}</span>
        <span style="color:var(--red)">PUT ${pc.puts.toLocaleString("it-IT")}</span>
      </div>
      <div class="info-line muted" style="font-size:11px;margin-top:8px">
        Volumi sulle prime due scadenze. <b>Per il portafoglio:</b> un ratio in forte salita segnala aumento di copertura (possibile risk-off in arrivo); un ratio molto basso segnala compiacenza (rischio di correzione su sorprese negative).
      </div>`;
    // QUADRUPLE WITCHING (4 streghe): per ogni titolo (portafoglio + watchlist) la barra indica
    // la PRESSIONE DI ROLLING/CHIUSURA dei contratti (volume opzioni vs volume medio del titolo +
    // open interest in scadenza), NON il tempo che manca.
    const w = m.witching;
    const seen = new Set();
    const optTk = [...(DATA.portfolio || []), ...(DATA.watchlist || [])]
      .filter(r => { if (seen.has(r.ticker) || !DATA.options?.[r.ticker]?.expiries?.length) return false; seen.add(r.ticker); return true; });
    if (optTk.length) {
      const rows = optTk.map(r => {
        const ch = DATA.options[r.ticker], ex = ch.expiries[0];
        const callOI = (ex.calls || []).reduce((s, o) => s + (o.oi || 0), 0);
        const putOI = (ex.puts || []).reduce((s, o) => s + (o.oi || 0), 0);
        const totOI = callOI + putOI;
        const pcr = callOI ? putOI / callOI : null;
        const ratio = ch.avg_volume ? (ex.opt_volume || 0) * 100 / ch.avg_volume * 100 : 0;
        const lvl = ratio >= 30 ? ["ALTO", "var(--red)"] : ratio >= 10 ? ["MEDIO", "var(--yellow)"] : ["BASSO", "var(--green)"];
        const bw = Math.max(4, Math.min(100, ratio));
        return `<tr><td><b>${r.ticker}</b></td>
          <td class="num pos">${ex.call_wall ? cur(r) + fmtNum.format(ex.call_wall) : "—"}</td>
          <td class="num neg">${ex.put_wall ? cur(r) + fmtNum.format(ex.put_wall) : "—"}</td>
          <td class="num">${totOI ? fmtBig(totOI) : "—"}</td>
          <td class="num">${pcr != null ? fmtNum.format(Math.round(pcr * 100) / 100) : "—"}</td>
          <td><span class="roll-bar"><span class="roll-fill" style="width:${bw.toFixed(0)}%;background:${lvl[1]}"></span></span> <span style="color:${lvl[1]};font-size:11px;font-family:var(--mono)">${lvl[0]}</span></td></tr>`;
      }).join("");
      extra += `<h4 style="margin:14px 0 4px">Quadruple Witching (4 streghe) — pressione di rolling per titolo</h4>
        <div class="info-line muted" style="font-size:11px;margin-bottom:4px">Alle "4 streghe" (3° venerdì di mar/giu/set/dic) gli operatori devono <b>chiudere o rinnovare (rolling)</b> i contratti in scadenza: si generano volumi record e alta volatilità, con il prezzo "attratto" verso i muri di opzioni (Call/Put Wall). La <b>barra</b> misura la pressione di rolling del titolo = volume opzioni rispetto al volume medio (ALTO = forte attività derivati).${w?.next ? ` Prossima scadenza: <b>${new Date(w.next).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" })}</b>.` : ""}</div>
        <table class="info-table"><thead><tr><th>Titolo</th><th>Call Wall</th><th>Put Wall</th><th>OI tot.</th><th>P/C OI</th><th>Pressione rolling</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="info-line muted" style="font-size:11px;margin-top:6px">OI tot. = open interest totale (call+put) sulla scadenza più vicina · P/C OI = rapporto put/call OI. Strategia: nei giorni di scadenza attenzione agli spike intraday; valuta di chiudere/rollare le tue opzioni 1-2 giorni prima.</div>`;
    }
  } else if (key === "yield_recession" && m.yield_recession) {
    const yr = m.yield_recession;
    const cc = yr.current_curve, c12 = yr.curve_12m_ago;
    const ccCol = cc == null ? "var(--muted)" : cc < 0 ? "var(--red)" : yr.steepening ? "var(--yellow)" : "var(--green)";
    extra = `<div class="info-line muted" style="font-size:11.5px;margin-bottom:8px">
        Storicamente, quando la <b>curva dei rendimenti</b> (differenza tra Treasury USA a 10 e 2 anni) esce da un'inversione e si <b>irripidisce bruscamente</b>, una recessione tende a seguire entro ~12 mesi. La curva inverte prima, poi torna positiva proprio mentre l'economia rallenta. Le bande grigie sono le recessioni USA (NBER).
      </div>
      <div class="info-line"><b>Spread 10A-2A attuale:</b> <span style="color:${ccCol}">${cc != null ? (cc > 0 ? "+" : "") + fmtNum.format(cc) + " pp" : "—"}</span> ${c12 != null ? `<span class="muted">(12 mesi fa ${c12 > 0 ? "+" : ""}${fmtNum.format(c12)} pp)</span>` : ""}</div>
      <div class="info-line"><b>Stato:</b> <span style="color:${ccCol}">${esc(yr.label || "")}</span></div>
      ${yr.gdp_last != null ? `<div class="info-line"><b>Crescita PIL reale (YoY):</b> ${yr.gdp_last > 0 ? "+" : ""}${fmtNum.format(yr.gdp_last)}%</div>` : ""}
      ${yr.claims_last != null ? `<div class="info-line"><b>Sussidi disoccupazione (sett.):</b> ${fmtNum.format(yr.claims_last)}</div>` : ""}
      <h4 style="margin:14px 0 4px">Curva 10A-2A vs PIL reale · recessioni in grigio</h4>
      ${recessionChart(yr.curve, yr.gdp_growth, yr.recessions)}
      <h4 style="margin:16px 0 4px">Curva shiftata di 12 mesi vs crescita PIL</h4>
      <div class="info-line muted" style="font-size:11px;margin-bottom:4px">La curva è traslata in avanti di 12 mesi: dove la curva (blu) anticipa la caduta del PIL (verde) si vede la sua capacità predittiva sulle recessioni.</div>
      ${recessionChart(yr.curve, yr.gdp_growth, yr.recessions, { shiftMonths: 12 })}
      <div class="info-line muted" style="font-size:11px;margin-top:8px">
        <b>Lettura attuale:</b> ${yr.steepening && yr.was_inverted_24m
          ? "la curva si sta irripidendo dopo un'inversione ma il PIL e l'occupazione restano resilienti: il segnale storico invita alla prudenza pur in assenza, per ora, di recessione."
          : (cc != null && cc < 0) ? "curva ancora invertita: storicamente precede recessioni di 12-18 mesi."
          : "curva normale/positiva: nessun segnale di stress imminente dalla struttura dei tassi."}
        Fonte: FRED (T10Y2Y, GDPC1, USREC, ICSA).
      </div>`;
  } else if (key === "credit" && m.credit) {
    const cr = m.credit;
    const crCol = scoreColor(cr.score);
    extra = `<div class="info-line"><b>Spread HY (ICE BofA OAS):</b> <span style="color:${crCol}">${fmtNum.format(cr.spread_hy)}% — ${cr.label}</span> <span class="muted">(${cr.date})</span></div>
      ${thermoBar(cr.score, ["Basso", "Elevato"])}
      <div class="info-line muted" style="font-size:11px;margin-top:6px">L'OAS High Yield misura il premio di rischio obbligazionario rispetto ai Treasury.<br>
      <b>&lt;4%</b> normale &nbsp;·&nbsp; <b>5-7%</b> stress &nbsp;·&nbsp; <b>&gt;9%</b> crisi sistemica. Proxy CDS via FRED (ICE BofA).</div>`;
    if ((cr.history || []).length > 1) {
      extra += `<h4 style="margin:12px 0 4px">Andamento spread HY (1 anno)</h4>
        ${miniLineChart(cr.history, { color: crCol })}`;
    }
  } else if (key === "systemic_risk" && m.systemic_risk) {
    const sr = m.systemic_risk;
    const stCol = sr.rising ? "var(--red)" : sr.score >= 60 ? "var(--green)" : sr.score <= 40 ? "var(--red)" : "var(--yellow)";
    extra = `<div class="info-line muted" style="font-size:11.5px;margin-bottom:8px">
        Il mercato del credito (CDS / spread obbligazionari) anticipa sistematicamente l'azionario: un allargamento brusco degli spread = aumenta il costo per assicurarsi contro i fallimenti = segnale di <b>risk-off</b> in arrivo.
      </div>
      <div class="info-line"><b>Stato:</b> <span style="color:${stCol};font-weight:700">${esc(sr.status)}</span></div>
      ${thermoBar(sr.score, ["Rilassato", "Stress"])}
      <table class="info-table" style="margin-top:8px"><thead><tr><th>Spread (proxy CDS)</th><th class="num">Livello</th><th class="num">Var. 1 mese</th></tr></thead><tbody>
        <tr><td><b>High Yield OAS</b> (CDX HY proxy)</td><td class="num">${sr.hy_oas != null ? fmtNum.format(sr.hy_oas) + "%" : "—"}</td><td class="num ${signCls(sr.hy_chg_1m)}">${sr.hy_chg_1m != null ? signTxt(sr.hy_chg_1m) : "—"}</td></tr>
        <tr><td>Investment Grade OAS</td><td class="num">${sr.ig_oas != null ? fmtNum.format(sr.ig_oas) + "%" : "—"}</td><td class="num ${signCls(sr.ig_chg_1m)}">${sr.ig_chg_1m != null ? signTxt(sr.ig_chg_1m) : "—"}</td></tr>
        ${sr.hy_ig != null ? `<tr><td>Rapporto HY/IG (fuga qualità)</td><td class="num">${fmtNum.format(sr.hy_ig)}×</td><td class="num">—</td></tr>` : ""}
        ${sr.stlfsi != null ? `<tr><td>Indice Stress Finanziario (St. Louis Fed)</td><td class="num ${sr.stlfsi > 0 ? "neg" : "pos"}">${signTxt(sr.stlfsi)}</td><td class="num">—</td></tr>` : ""}
      </tbody></table>
      <div class="info-line muted" style="font-size:11px;margin-top:8px">
        Spread in % MoM. <b>HY OAS</b>: &lt;4% normale · 5-7% stress · &gt;9% crisi. <b>HY/IG</b> in salita = rotazione verso la qualità (difensivo). <b>STLFSI &gt;0</b> = stress sopra la media. Per il debito sovrano USA non esiste un CDS gratuito affidabile: si usa l'indice di stress finanziario come proxy sistemico. Fonte: FRED (BofA OAS, STLFSI4).
      </div>`;
  } else if (key === "decouple" && m.decouple) {
    const dc = m.decouple;
    const spLast = dc.sp500[dc.sp500.length - 1].v;
    const gdLast = dc.gdp[dc.gdp.length - 1].v;
    const gap = Math.round(spLast - gdLast);
    const gapCol = gap > 40 ? "var(--red)" : gap > 20 ? "var(--yellow)" : "var(--green)";
    extra = `<div class="info-line"><b>S&amp;P 500 (normalizzato):</b> <span class="pos">${signTxt(spLast - 100)} dal periodo base</span></div>
      <div class="info-line"><b>PIL reale USA (GDPC1):</b> ${signTxt(gdLast - 100)} dal periodo base</div>
      <div class="info-line"><b>Gap (disaccoppiamento):</b> <span style="color:${gapCol}">${gap > 0 ? "+" : ""}${gap} pp — ${gap > 40 ? "speculazione elevata" : gap > 20 ? "valutazione tesa" : "disaccoppiamento contenuto"}</span></div>
      <h4 style="margin:12px 0 4px">S&amp;P 500 vs PIL reale (base 100 = inizio periodo)</h4>
      ${miniDualChart(dc.sp500, dc.gdp, { color1: "var(--blue)", color2: "var(--green)", label1: "S&P 500", label2: "PIL reale" })}
      <div class="info-line muted" style="font-size:11px;margin-top:6px">Un gap ampio segnala che la borsa ha prezzato una crescita degli utili superiore a quella dell'economia reale. Storico pre-correzione: gap &gt;40 pp in 2000, 2007 e 2021.</div>`;
  } else if (key === "smart_money" && m.smart_money) {
    const sm = m.smart_money;
    const smCol = scoreColor(sm.score);
    const fgScore = m.fear_greed?.score;
    const fgLabel = fgScore != null ? (FG_LABELS[m.fear_greed?.rating] || m.fear_greed?.rating || "") : "";
    let divAlert = "";
    if (fgScore != null && sm.score != null) {
      if (fgScore > 75 && sm.score < 30)
        divAlert = `<div class="sm-alert danger"><b>DIVERGENZA PERICOLOSA: Rischio Distribuzione Istituzionale</b><br>Retail in Long Estremo (Fear &amp; Greed ${fgScore}/100) mentre gli istituzionali mantengono posizione difensiva (${sm.score}/100). Setup storicamente associato a correzioni: gli "smart money" si distribuiscono sulla massa retail in euforia.</div>`;
      else if (fgScore < 25 && sm.score > 70)
        divAlert = `<div class="sm-alert bullish"><b>ACCUMULO ISTITUZIONALE: Setup Rialzista</b><br>Retail in Paura Estrema (Fear &amp; Greed ${fgScore}/100) mentre gli istituzionali accumulano aggressivamente (${sm.score}/100). Classico bottom con "blood in the streets" e accumulo smart money — storicamente setup rialzista.</div>`;
    }
    extra = `${divAlert}<div class="info-line muted" style="font-size:11.5px;margin-bottom:8px">
        Indicatore basato sui <b>Smart Money Concepts (SMC)</b> calcolati dai prezzi (OHLC) di <b>S&amp;P 500 e Nasdaq 100</b>: struttura di mercato e rottura di struttura (<b>BOS</b>), <b>FVG</b> (Fair Value Gap), zone di <b>liquidità</b> (stop sopra i massimi / sotto i minimi) e <b>order block</b>. Verde = struttura rialzista/accumulazione istituzionale; rosso = distribuzione.
      </div>
      <h4 style="margin:8px 0 4px">Confronto visivo: Istituzionali vs Retail (Fear &amp; Greed)</h4>
      <div class="dual-idx">
        <div class="dual-idx-block">
          ${compactSemiGauge(sm.score, ["Bullish (Long)", "Bearish (Short)"])}
          <div class="dual-idx-label">Istituzionali (SMC)</div>
          <div class="dual-idx-val" style="color:${smCol}">${sm.score}/100 &middot; ${sm.label}</div>
        </div>
        ${fgScore != null ? `<div class="dual-idx-block">
          ${compactSemiGauge(fgScore, ["Paura", "Avidità"])}
          <div class="dual-idx-label">Retail (Fear &amp; Greed)</div>
          <div class="dual-idx-val" style="color:${scoreColor(fgScore)}">${fgScore}/100${fgLabel ? ` &middot; ${fgLabel}` : ""}</div>
        </div>` : ""}
      </div>
      <div class="info-line"><b>Posizionamento istituzionale:</b> <span style="color:${smCol}">${sm.score}/100 — ${sm.label}</span></div>
      ${thermoBar(sm.score, ["Bullish (Long)", "Bearish (Short)"])}`;
    const arrow = d => d === "rialzista" ? '<span class="pos">▲ rialzista</span>' : d === "ribassista" ? '<span class="neg">▼ ribassista</span>' : '<span class="muted">laterale</span>';
    const smcIdx = sm.smc_indices || {};
    const smcCard = (s) => {
      if (!s) return "";
      const c = scoreColor(s.bias);
      return `<div class="smc-card">
        <div class="smc-head"><b>${esc(s.label_idx || "")}</b> <span style="color:${c}">${s.bias}/100 · ${s.label}</span></div>
        <div class="smc-line">Struttura: ${arrow(s.structure)} &nbsp;·&nbsp; BOS: ${s.bos ? arrow(s.bos) : "—"}</div>
        <div class="smc-line">FVG aperti: <span class="pos">${s.bull_fvg} ↑</span> / <span class="neg">${s.bear_fvg} ↓</span>${s.last_fvg ? ` · ultimo ${s.last_fvg.dir} ${fmtNum.format(s.last_fvg.lo)}–${fmtNum.format(s.last_fvg.hi)}` : ""}</div>
        <div class="smc-line">Liquidità: sopra <b>${s.liq_above != null ? fmtNum.format(s.liq_above) : "—"}</b> · sotto <b>${s.liq_below != null ? fmtNum.format(s.liq_below) : "—"}</b>${s.order_block ? ` · Order block ${s.order_block.dir} ${fmtNum.format(s.order_block.lo)}–${fmtNum.format(s.order_block.hi)}` : ""}</div>
      </div>`;
    };
    if (Object.keys(smcIdx).length) {
      extra += `<h4 style="margin:12px 0 4px">SMC degli indici (driver dell'indicatore)</h4>${smcCard(smcIdx.sp500)}${smcCard(smcIdx.nasdaq)}`;
    }
    const ptfSmc = (DATA.portfolio || []).filter(r => r.smc);
    if (ptfSmc.length) {
      const dd = d => d === "rialzista" ? '<span class="pos">▲</span>' : d === "ribassista" ? '<span class="neg">▼</span>' : '<span class="muted">–</span>';
      const rows = ptfSmc.map(r => {
        const s = r.smc, c = scoreColor(s.bias), bw = Math.max(6, Math.min(100, s.bias));
        return `<tr><td><b>${r.ticker}</b></td><td>${dd(s.structure)} ${esc(s.structure)}</td><td>${s.bos ? dd(s.bos) : "—"}</td>
          <td class="num"><span class="pos">${s.bull_fvg}</span>/<span class="neg">${s.bear_fvg}</span></td>
          <td><span class="roll-bar"><span class="roll-fill" style="width:${bw}%;background:${c}"></span></span> <span style="color:${c};font-family:var(--mono);font-size:11px">${s.bias}</span></td></tr>`;
      }).join("");
      extra += `<h4 style="margin:12px 0 4px">SMC dei tuoi titoli</h4>
        <table class="info-table"><thead><tr><th>Titolo</th><th>Struttura</th><th>BOS</th><th>FVG ↑/↓</th><th>Bias SMC</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    if (sm.divergence != null) {
      const dvCol = Math.abs(sm.divergence) > 15 ? "var(--yellow)" : "var(--green)";
      extra += `<div class="info-line" style="margin-top:8px"><b>Divergenza Istituzionali vs Retail:</b> <span style="color:${dvCol}">${sm.divergence > 0 ? "+" : ""}${sm.divergence} pt — ${sm.divergence_label}</span></div>
        <div class="info-line muted" style="font-size:11px">Fear &amp; Greed (retail) ${fgScore ?? "—"}/100 vs Istituzionali ${sm.score}/100. Un gap ampio segnala possibile inversione: quando il retail è euforico ma gli istituzionali si coprono, storicamente precede correzioni.</div>`;
    }
    if ((sm.components || []).length) {
      extra += `<h4 style="margin:10px 0 4px">Componenti del segnale</h4>` + sm.components.map(c =>
        `<div class="info-line" style="display:flex;justify-content:space-between;align-items:center"><span>${c.label}</span><span style="color:${scoreColor(c.score)};font-family:var(--mono)">${c.score}</span></div>`).join("");
    }
    const det = [];
    if (sm.vix_term_ratio != null) det.push(`VIX/VIX3M ${fmtNum.format(sm.vix_term_ratio)} ${sm.vix_term_ratio > 1 ? "(backwardation = tensione)" : "(contango = calma)"}`);
    if (sm.hy_ig_ratio != null) det.push(`HY/IG ${fmtNum.format(sm.hy_ig_ratio)}`);
    if (det.length) extra += `<div class="info-line muted" style="font-size:11px;margin-top:6px">${det.join(" · ")}</div>`;
  } else if (key === "sp500_pe" && m.sp500_pe) {
    const pe = m.sp500_pe;
    const peCol = pe.current > 35 ? "var(--red)" : pe.current > 25 ? "var(--yellow)" : pe.current > 14 ? "var(--muted)" : "var(--green)";
    const ndxPeCol = pe.nasdaq_pe > 40 ? "var(--red)" : pe.nasdaq_pe > 30 ? "var(--yellow)" : "var(--muted)";
    const ndxRow = pe.nasdaq_pe ? `<div class="info-line"><b>Nasdaq 100 (QQQ) P/E attuale:</b> <span style="color:${ndxPeCol}">${pe.nasdaq_pe}×</span> <span class="muted" style="font-size:11px">(storicamente NDX tratta a premio vs S&P; sopra 35× indica valutazioni tech tese)</span></div>` : "";
    extra = `<div class="info-line"><b>S&P 500 P/E attuale:</b> <span style="color:${peCol}">${pe.current}× — ${pe.label}</span></div>
      ${ndxRow}
      ${pe.avg_10y != null ? `<div class="info-line"><b>Media S&P ultimi 10 anni:</b> ${pe.avg_10y}×</div>` : ""}
      ${pe.pct_rank != null ? `<div class="info-line"><b>Percentile storico S&P:</b> il mercato è stato più economico di adesso nel ${pe.pct_rank}% dei mesi degli ultimi 10 anni</div>` : ""}
      ${thermoBar(pe.score, ["Sottovalutato", "Sopravvalutato"])}
      <div class="info-line muted" style="font-size:11px;margin:6px 0">
        P/E &gt;25: valutazioni tese, storicamente associate a ritorni futuri più bassi nei 10 anni successivi.
        P/E &gt;35: livelli estremi raggiunti solo nel 1999-2000 (bolla dot-com) e nel 2020-2021 (post-pandemia).<br>
        Il P/E trailing usa gli utili degli ultimi 12 mesi — è più volatile del CAPE di Shiller (10 anni), ma più reattivo.
      </div>
      ${(pe.history || []).length >= 2
        ? `<h4 style="margin:12px 0 4px">P/E S&P 500 — ${pe.history.length} rilevazioni (${esc(pe.source || "FRED")})</h4>
           ${miniLineChart(pe.history, { color: "var(--yellow)", zeroLine: false })}`
        : `<div class="info-line muted" style="font-size:11.5px;margin-top:10px"><b>Storico non disponibile da questa fonte.</b>
             Il titolo di questo riquadro prometteva "storico 10 anni" mentre la serie ha ${(pe.history || []).length} rilevazione${(pe.history || []).length === 1 ? "" : "i"}
             (fonte: ${esc(pe.source || "n.d.")}) — e per lo stesso motivo mancano la media a 10 anni e il percentile storico.
             Resta valido il P/E corrente qui sopra.</div>`}
      <div class="info-line muted" style="font-size:11px;margin-top:6px">
        <b>Implicazione per il portafoglio:</b> P/E elevato significa che ogni dollaro di utile è pagato di più.
        In scenari di rialzo dei tassi + P/E &gt;25, i multipli tendono a comprimersi (-15% / -30% dall'inizio storico).
        Suggerito: privilegiare titoli con P/E inferiore alla media settoriale e FCF yield elevato.
      </div>`;
  } else if (key === "corp_profit" && m.corp_profit) {
    const cp = m.corp_profit;
    const gapCol = cp.gap > 40 ? "var(--red)" : cp.gap > 20 ? "var(--yellow)" : "var(--green)";
    const ndxGapCol = cp.ndx_gap != null ? (cp.ndx_gap > 40 ? "var(--red)" : cp.ndx_gap > 20 ? "var(--yellow)" : "var(--green)") : "var(--muted)";
    extra = `<div class="info-line"><b>Gap S&amp;P 500 vs Profitti Reali:</b> <span style="color:${gapCol}">${cp.gap > 0 ? "+" : ""}${cp.gap} pp — ${cp.label}</span></div>
      ${cp.ndx_gap != null ? `<div class="info-line"><b>Gap Nasdaq 100 vs Profitti Reali:</b> <span style="color:${ndxGapCol}">${cp.ndx_gap > 0 ? "+" : ""}${cp.ndx_gap} pp</span> <span class="muted" style="font-size:11px">(il Nasdaq tratta storicamente a premio su S&P)</span></div>` : ""}
      ${thermoBar(cp.score, ["Allineati", "Asset Inflation"])}
      <div class="info-line muted" style="font-size:11px;margin:6px 0">
        Quando S&amp;P 500 e Nasdaq 100 nominali crescono molto più dei profitti aziendali reali, l'eccesso è spiegato da svalutazione monetaria (fiat debasement) e non da crescita degli utili.
        Storicamente gap &gt;40 pp precede correzioni prolungate o lateralizzazione. Vedi 2000, 2007, 2021.
      </div>
      <h4 style="margin:12px 0 4px">S&amp;P 500 nominale vs Profitti Aziendali Reali USA (base 100)</h4>
      ${miniDualChart(cp.sp500, cp.profits, { color1: "var(--blue)", color2: "var(--yellow)", label1: "S&P 500 nominale", label2: "Profitti reali (FRED CP)" })}
      ${cp.ndx ? `<h4 style="margin:12px 0 4px">Nasdaq 100 nominale vs Profitti Aziendali Reali USA (base 100)</h4>
      ${miniDualChart(cp.ndx, cp.profits, { color1: "var(--purple)", color2: "var(--yellow)", label1: "Nasdaq 100", label2: "Profitti reali (FRED CP)" })}` : ""}
      <div class="info-line muted" style="font-size:11px;margin-top:6px">
        <b>Scenario breve (0-6 mesi):</b> se gap cresce, la borsa sale per illusione nominale, non per utili reali — rischio di correzione tecnica.<br>
        <b>Scenario lungo (12-36 mesi):</b> riallineamento tramite stagnazione dei prezzi o calo degli utili nominali; trigger: inflazione in risalita, scadenze fiscali, rallentamento consumi.
      </div>`;
  } else if (key === "fed_market" && m.fed_market) {
    const fm = m.fed_market;
    const rateCol = fm.current_rate > 4.5 ? "var(--red)" : fm.current_rate > 2.5 ? "var(--yellow)" : "var(--green)";
    extra = `<div class="info-line"><b>Fed Funds Rate attuale:</b> <span style="color:${rateCol}">${fm.current_rate}%</span>
        <span class="muted"> · rilevazione ${fm.rate_date}</span></div>
      <div class="info-line muted" style="font-size:11px;margin:6px 0">
        Il grafico mostra la correlazione storica tra il ciclo dei tassi Fed (rosso) e l'andamento dell'S&amp;P 500 (blu).
        I rialzi comprimono i multipli P/E; i tagli innescano rally. Le scale sono normalizzate per sovrapposizione visiva.
      </div>
      <h4 style="margin:12px 0 4px">Fed Funds Rate (%) vs S&amp;P 500 — ultimi 5 anni</h4>
      ${miniDualChart(fm.fedfunds, fm.sp500.map(p => ({ d: p.d, v: p.v / 1000 })),
        { color1: "var(--red)", color2: "var(--blue)", label1: "Fed Funds Rate (%)", label2: "S&P 500 (÷1000)" })}
      <div class="info-line muted" style="font-size:11px;margin-top:6px">
        Con Fed Funds &gt;4% la storia mostra compressione dei multipli azionari entro 12-18 mesi.
        Un taglio rapido (emergenza) storico precede rally ma anche segnali di crisi economica.
      </div>`;
  } else {
    extra = `<div class="info-line"><b>Aggiornamento:</b> ${cadence}</div>`;
  }

  // curva storica: aggiunge il grafico al popup esistente di "in:curve"
  if (key === "in:curve" && (m.curve_history || []).length > 1) {
    const lastV = m.curve_history[m.curve_history.length - 1].v;
    const crvCol = lastV >= 0 ? "var(--green)" : "var(--red)";
    extra += `<h4 style="margin:12px 0 4px">Storico curva 10A-2A (2 anni)</h4>
      ${miniLineChart(m.curve_history, { color: crvCol, zeroLine: true })}
      <div class="info-line muted" style="font-size:11px;margin-top:4px">Sotto zero = inversione = segnale storico di recessione. La dis-inversione (risalita verso 0 e oltre) è in corso da fine 2023.</div>`;
  }

  openInfoModal(name, `<p style="margin:0 0 10px">${desc}</p>${extra}`);
}

function openEarningsInfo(ticker) {
  const r = (DATA.portfolio || []).find(x => x.ticker === ticker);
  if (!r) return;
  const days = giorniAllaTrimestrale(r.earnings_date);
  const rx = new RegExp(`${ticker}|${(r.name || "").split(" ")[0]}|earnings|trimestral|utili|risultati`, "i");
  const RAT_SCORE = { strong_buy: 100, buy: 75, hold: 50, sell: 25, strong_sell: 0 };
  const RAT_LABEL = { strong_buy: "Strong Buy", buy: "Buy", hold: "Hold", sell: "Sell", strong_sell: "Strong Sell" };
  const st = r.stats || {};
  const epsForward = st.eps_forward;
  const epsTTM = st.eps_ttm ?? r.eps;
  const epsDelta = (epsForward != null && epsTTM != null && epsTTM !== 0) ? (epsForward / Math.abs(epsTTM) - 1) * 100 : null;
  // gauge raccomandazione: SEMPRE tachimetro verde-sx (Strong Buy) → rosso-dx (Strong Sell)
  let consensoHtml = "";
  if (r.rating?.key) {
    const rs = RAT_SCORE[r.rating.key] ?? 50;
    const rLab = RAT_LABEL[r.rating.key] ?? r.rating.key;
    consensoHtml = `<h4 style="margin:12px 0 4px">Consenso analisti</h4>
      <div style="max-width:200px;margin:0 auto">${compactSemiGauge(rs, ["Strong Buy", "Strong Sell"])}</div>
      <div class="info-line" style="text-align:center;margin-top:2px"><b style="color:${scoreColor(rs)}">${rLab}</b>
        <span class="muted"> · ${r.rating.n ?? "—"} analisti</span></div>`;
  }
  // valori attesi: SEMPRE presenti (target, EPS stimato vs attuale, crescita attesa)
  const exp = [];
  if (r.rating?.target) exp.push(`<tr><td>Target medio analisti</td><td class="num"><b>${cur(r)}${fmtNum.format(r.rating.target)}</b> <span class="${signCls(r.rating.upside_pct)}">(${signTxt(r.rating.upside_pct)})</span></td></tr>`);
  if (epsForward != null) exp.push(`<tr><td>EPS stimato (prossimi 12M)</td><td class="num"><b>${cur(r)}${fmtNum.format(epsForward)}</b>${epsDelta != null ? ` <span class="${signCls(epsDelta)}">(${signTxt(Math.round(epsDelta))} vs TTM)</span>` : ""}</td></tr>`);
  if (epsTTM != null) exp.push(`<tr><td>EPS attuale (TTM)</td><td class="num">${cur(r)}${fmtNum.format(epsTTM)}</td></tr>`);
  if (st.earnings_growth != null) exp.push(`<tr><td>Crescita utili attesa</td><td class="num ${st.earnings_growth > 0 ? "pos" : "neg"}">${pctOf(st.earnings_growth)}</td></tr>`);
  if (st.revenue_growth != null) exp.push(`<tr><td>Crescita ricavi attesa</td><td class="num ${st.revenue_growth > 0 ? "pos" : "neg"}">${pctOf(st.revenue_growth)}</td></tr>`);
  if (st.forward_pe != null) exp.push(`<tr><td>P/E prospettico</td><td class="num">${fmtNum.format(st.forward_pe)}×</td></tr>`);
  const expHtml = exp.length ? `<h4 style="margin:12px 0 4px">Valori attesi</h4>
    <table class="info-table"><tbody>${exp.join("")}</tbody></table>` : "";
  openInfoModal(`${r.name} (${ticker}) — Trimestrale`, `
    <div class="info-line"><b>Data attesa:</b> ${r.earnings_date ? new Date(r.earnings_date).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }) : "n/d"} ${days != null ? `(tra ${days} gg)` : ""}</div>
    ${consensoHtml}
    ${expHtml}
    <div class="info-line muted" style="margin:10px 0 12px">EPS e stime si aggiornano dopo ogni trimestrale. Target = media analisti coverage; crescita attesa e P/E prospettico dal consenso (fonte: yfinance).</div>`);
}

// pulsante elimina SEMPRE visibile accanto al nome (no edit-mode); BTP escluso
function nameDelBtn(section, ticker) {
  if (ticker === "BTP-V28") return "";
  return `<button class="row-del row-del-inline" data-sec="${section}" data-tk="${ticker}" title="Rimuovi ${ticker}" aria-label="Rimuovi ${ticker}">×</button>`;
}

// modifica quantità e prezzo medio di carico di una posizione esistente
function editPosition(ticker) {
  const r = (DATA.portfolio || []).find(x => x.ticker === ticker);
  if (!r) return;
  const qty = parseFloat(window.prompt(`Nuova quantità di ${ticker}:`, r.qty) || "");
  if (!(qty >= 0)) { toast("Quantità non valida"); return; }
  const pmc = parseFloat(window.prompt(`Nuovo prezzo medio di carico (PMC) di ${ticker}:`, r.pmc) || "");
  if (!(pmc > 0)) { toast("PMC non valido"); return; }
  // aggiornamento IMMEDIATO su dashboard e riga (poi salva su config in background)
  r.qty = qty; r.pmc = pmc;
  if (r.currency === "USD" && r.price != null) {
    r.value = r.price * qty; r.gain = r.value - pmc * qty;
    r.gain_pct = Math.round((r.value / (pmc * qty) - 1) * 10000) / 100;
  }
  recomputeTotals(); renderKPI(); renderTable(); renderAllocation();
  toast(`${ticker} aggiornato — salvo nel repo…`);
  editHoldings("portfolio", cfg => {
    const p = (cfg.portfolio || []).find(x => x.ticker === ticker);
    if (!p) return false;
    p.qty = qty; p.pmc = pmc;
    return true;
  });
}


function renderTable() {
  const eurusd = DATA.eurusd || 1.08;
  // scala comune a tutte le righe della colonna Guad. %: senza, ogni barra sarebbe relativa a
  // se stessa e il confronto fra righe — l'unico motivo per cui la barra esiste — sparirebbe
  const scalaGuad = Math.max(25, ...(DATA.portfolio || []).map(x => Math.abs(x.gain_pct || 0)));
  const rows = sortRows(DATA.portfolio, "ptf-table").map(r => {
    const c = cur(r);
    // guadagno EUR = verità broker (bgain) se presente, altrimenti dai prezzi live
    const gEur = r.gain_eur != null ? r.gain_eur : (r.currency === "EUR" ? (r.gain || 0) : (r.gain || 0) / eurusd);
    const gPct = (r.bval != null && (r.bval - r.bgain)) ? r.bgain / (r.bval - r.bgain) * 100 : r.gain_pct;
    return `<tr>
      <td class="name-cell" data-tk="${r.ticker}" title="Clicca per la scheda completa">${r.qty && r.stop_violated ? `<span class="badge badge-earnrisk" title="Il prezzo è SOTTO lo stop trailing ancorato ($${fmtNum.format(r.stop_atr)}): uscita o ri-arm consapevole. Lo stop ratchet non si riabbassa da solo.">[STOP VIOLATO]</span> ` : ""}${nameDelBtn("portfolio", r.ticker)}${r.name}<span class="tk">${r.ticker}</span></td>
      <td class="num">${fmtNum.format(r.qty)}</td>
      <td class="num">${c}${fmtNum.format(r.pmc)}</td>
      <td class="num"><b>${priceTxt(r, c)}</b></td>
      ${cellaBarra(r.change_pct, 3, signTxt(r.change_pct), { mid: true, title: "barra su scala fissa ±3%" })}
      <td class="num">${prepostCell(r.prepost)}</td>
      ${volumeCell(r)}
      <td class="num ${signCls(gEur)}">${signTxt(Math.round(gEur), " €")}${r.currency === "USD" && r.gain != null ? `<br><span class="sub-eur muted">${signTxt(Math.round(r.gain), " $")} live</span>` : ""}</td>
      ${cellaBarra(gPct, scalaGuad, `<b>${signTxt(Math.round(gPct * 100) / 100)}</b>`, { mid: true, title: `barra su scala ±${fmtNum.format(Math.round(scalaGuad))}% (la posizione più estesa del portafoglio)` })}
      ${techCells(r)}
      ${fundCells(r)}
    </tr>`;
  }).join("");

  const t = DATA.totals;
  const usdValue = DATA.portfolio.filter(r => r.currency === "USD").reduce((s, r) => s + r.value, 0);
  const totalRow = `<tr class="total-row">
    <td class="name-cell" colspan="7">TOTALE — ${fmtEUR.format(t.eur_value)} · azioni $${fmtNum.format(Math.round(usdValue))}</td>
    <td class="num ${signCls(t.eur_gain)}">${signTxt(Math.round(t.eur_gain), " €")}</td>
    <td class="num ${signCls(t.eur_gain_pct)}"><b>${signTxt(t.eur_gain_pct)}</b></td>
    <td colspan="19" class="muted" style="font-family:Inter,sans-serif">netto tasse stimato: <b class="${signCls(t.eur_gain_net)}">${signTxt(Math.round(t.eur_gain_net ?? t.eur_gain), " €")}</b></td>
  </tr>`;
  const addRow = editMode.portfolio
    ? `<tr class="add-row"><td colspan="28"><button class="btn btn-ghost btn-sm" id="ptf-add">+ Aggiungi titolo</button></td></tr>` : "";
  $("#ptf-table tbody").innerHTML = rows + totalRow + addRow;
  applicaVistaCompattaSePrimaVolta("ptf-table");
  applyColOrder("ptf-table");
  applyColVisibility("ptf-table");
  renderVistaSwitch("ptf-table", "#ptf-vista");   // v188: dopo il riordino — legge l'ordine per accorciare i colspan
  applyColLabels("ptf-table");
}

// Etichette colonne sui td (per la vista "a schede" su iPhone) + marcatura colonne chiave.
// ⚠ Le stringhe devono coincidere ESATTAMENTE con i testi delle <th> (index.html per le viste
// tecniche, head[] di buildFundTable per le fondamentali): un mismatch fa sparire la colonna
// dalle card mobile (test di guardia in test_app.mjs).
/* ⚠ v251 — RIALLINEATO alle colonne nuove: "Segnale" e "Financial Health" non esistono più,
   e un'etichetta orfana qui è muta (nessun errore, solo una colonna che su iPhone non viene
   mai evidenziata). Al loro posto entra il MARGINE NETTO, che su uno schermo stretto dice più
   di un punteggio composito. */
const MOBILE_KEY_COLS = new Set(["Titolo", "Prezzo", "Oggi", "Guad. %", "Drawdown 52S",
  "Trimestrale", "Marg. netto"]);
function applyColLabels(tableId) {
  // textContent può contenere la freccia di sort (" ▼"/" ▲") appesa da updateSortArrows: va tolta
  const ths = [...document.querySelectorAll(`#${tableId} thead th`)].map(t => t.textContent.replace(/[▲▼]/g, "").trim());
  document.querySelectorAll(`#${tableId} tbody tr`).forEach(tr => {
    if (tr.classList.contains("total-row") || tr.classList.contains("add-row")) return;
    [...tr.children].forEach((td, i) => {
      // td con colspan = nota che copre più colonne ("Dati fondamentali non disponibili",
      // "Nessun dato", BTP): l'etichetta della colonna i sarebbe fuorviante e il testo lungo
      // sfonderebbe la griglia 2-col della card → niente label, riga intera (CSS td-key[colspan])
      if (td.colSpan > 1) { td.setAttribute("data-label", ""); td.classList.add("td-key"); return; }
      const lab = ths[i] || "";
      td.setAttribute("data-label", lab);
      td.classList.toggle("td-key", MOBILE_KEY_COLS.has(lab));
    });
  });
}

function renderWatchlist() {
  const list = sortRows(DATA.watchlist || [], "wl-table");
  const c = (r) => r.currency === "PTS" ? "" : "$";
  const rows = list.length ? list.map(r => `<tr>
      <td class="name-cell" data-tk="${r.ticker}" title="Clicca per la scheda completa">${nameDelBtn("watchlist", r.ticker)}${esc(r.name)}<span class="tk">${r.ticker}</span></td>
      <td class="num"><b>${priceTxt(r, c(r))}</b></td>
      ${cellaBarra(r.change_pct, 3, signTxt(r.change_pct), { mid: true, title: "barra su scala fissa ±3%" })}
      <td class="num">${prepostCell(r.prepost)}</td>
      ${volumeCell(r)}
      ${techCells(r)}
      ${fundCells(r)}
    </tr>`).join("") : '<tr><td colspan="24" class="muted">Nessun dato</td></tr>';
  const addRow = editMode.watchlist
    ? `<tr class="add-row"><td colspan="24"><button class="btn btn-ghost btn-sm" id="wl-add">+ Aggiungi titolo</button></td></tr>` : "";
  $("#wl-table tbody").innerHTML = rows + addRow;
  riparaVistaCompattaWl();          // v206 — ripara il default difettoso, se intatto
  applicaVistaCompattaSePrimaVolta("wl-table");
  applyColOrder("wl-table");
  applyColVisibility("wl-table");
  renderVistaSwitch("wl-table", "#wl-vista");    // v188: idem
  applyColLabels("wl-table");
}

/* ---------------- vista fondamentale (Value Investing) ---------------- */
const pctOf = (v) => v == null ? "—" : signTxt(Math.round(v * 1000) / 10);   // frazione → %
const pctPlain = (v) => v == null ? "—" : (Math.round(v * 1000) / 10) + "%";
function bigUsd(v) { if (v == null) return "—"; const a = Math.abs(v);
  if (a >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return "$" + (v / 1e6).toFixed(0) + "M"; return "$" + fmtNum.format(v); }

/* indicatore di impatto visivo per la vista fondamentale (come i bar della vista tecnica):
   score 0-100 (100 = favorevole/verde). Mostra valore colorato + mini-barra. */
function fundBar(val, fmt, score) {
  if (val == null || val === "" ) return "—";
  const txt = fmt(val);
  if (score == null) return txt;
  const s = Math.max(0, Math.min(100, score));
  return `<span class="fund-metric"><span style="color:${scoreColor(s)}">${txt}</span>
    <span class="fmeter"><span class="fmeter-fill" style="width:${Math.max(6, s)}%;background:${scoreColor(s)}"></span></span></span>`;
}
// punteggi di favorevolezza (frazioni dove indicato). higher=meglio salvo lowerBetter
const FSC = {
  roe: v => v == null ? null : clamp(v * 400),                 // 0,25→100 · 0,15→60
  gross: v => v == null ? null : clamp(v * 150),               // 0,66→100 · 0,40→60
  net: v => v == null ? null : clamp(50 + v * 200),            // 0→50 · 0,25→100 · neg→<50
  growth: v => v == null ? null : clamp(50 + v * 250),         // 0→50 · 0,2→100 · neg→<50
  pfcf: v => v == null ? null : clamp(100 - (v - 10) / 0.5),   // <10→100 · 35→50 (basso meglio)
  ev: v => v == null ? null : clamp(100 - (v - 8) / 0.3),      // <8→100 · 23→50 (basso meglio)
  pb: v => v == null ? null : clamp(100 - (v - 1) / 0.08),     // 1→100 · 5→50 (basso meglio)
  peg: v => v == null ? null : clamp(100 - (v - 0.5) / 0.03),  // 0,5→100 · 2→50 (basso meglio)
  div: v => v == null ? null : clamp(v * 1500),                // 0,04→60 (alto meglio)
  zscore: v => v == null ? null : clamp((v - 1) / 2.5 * 100),  // 1,81→32 · 2,99→80 (soglie Altman)
};

// renderer fondamentale generico (riusato da portafoglio e watchlist)




/* ---------------- trimestrali ---------------- */
function impliedMoveForEarnings(r) {
  const chain = optChain(r.ticker);
  if (!chain || !chain.expiries?.length || !r.earnings_date || !r.price) return null;
  const eDate = r.earnings_date;
  // trova la prima scadenza uguale o successiva alla data trimestrale
  const exp = chain.expiries.find(e => e.date >= eDate) || chain.expiries[0];
  if (!exp) return null;
  const spot = r.price;
  // trova call e put ATM (strike più vicino al prezzo corrente)
  const bestCall = (exp.calls || []).reduce((best, o) => {
    if (!o.price || o.price <= 0) return best;
    return !best || Math.abs(o.strike - spot) < Math.abs(best.strike - spot) ? o : best;
  }, null);
  const bestPut = (exp.puts || []).reduce((best, o) => {
    if (!o.price || o.price <= 0) return best;
    return !best || Math.abs(o.strike - spot) < Math.abs(best.strike - spot) ? o : best;
  }, null);
  if (!bestCall || !bestPut || spot <= 0) return null;
  return Math.round(((bestCall.price + bestPut.price) / spot) * 1000) / 10;
}

function renderEarnings() {
  const strip = $("#earnings-strip");
  if (!strip) return;   // strip rimossa: le trimestrali sono ora nella colonna di tabella
  const all = [...DATA.portfolio, ...(DATA.watchlist || [])];
  const items = all
    .filter(r => r.earnings_date)
    .map(r => ({ ...r, days: giorniAllaTrimestrale(r.earnings_date) }))
    .filter(r => r.days >= -1)
    .sort((a, b) => a.days - b.days);
  const ptfTickers = new Set(DATA.portfolio.map(x => x.ticker));
  strip.innerHTML = items.length ? items.map(r => {
    const d = new Date(r.earnings_date).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
    const when = r.days <= 0 ? "oggi" : r.days === 1 ? "domani" : `tra ${r.days} gg`;
    const pct = Math.max(6, Math.min(100, 100 - r.days * 1.1));
    const color = r.days <= 7 ? "var(--red)" : r.days <= 21 ? "var(--yellow)" : "var(--green)";
    const im = impliedMoveForEarnings(r);
    const imHtml = im != null
      ? `<div class="earn-im" style="color:${im >= 10 ? "var(--yellow)" : "var(--muted)"}" title="Implied Move (straddle ATM)">[+/- ${im}%]</div>`
      : "";
    const isWl = !ptfTickers.has(r.ticker);
    const wlMark = isWl ? `<span class="earn-wl" title="Watchlist">WL</span>` : "";
    return `<div class="earn-card${isWl ? " earn-card-wl" : ""}" data-earn="${r.ticker}" tabindex="0" role="button" title="${esc(r.name)}${isWl ? " (watchlist)" : ""} — clicca per dettagli">
      <div class="earn-top"><span class="earn-tk">${r.ticker}${wlMark}</span><span class="earn-date">${d}</span></div>
      <div class="earn-when" style="color:${color}">${when}</div>
      ${imHtml}
      <div class="impact"><span class="impact-fill" style="width:${pct}%;background:${color}"></span></div>
    </div>`;
  }).join("") : "";
}

/* ---------------- gauges ---------------- */
const FG_LABELS = { "extreme fear": "Paura estrema", fear: "Paura", neutral: "Neutrale", greed: "Avidità", "extreme greed": "Avidità estrema" };

/* colore sfumato verde(100)→arancio(50)→rosso(0) */
function scoreColor(s) {
  const h = Math.max(0, Math.min(120, (s / 100) * 120));   // 0=rosso, 60=giallo, 120=verde
  return `hsl(${h.toFixed(0)} 75% 47%)`;
}
// scala SEMPRE verde(sx)→rosso(dx). score 0-100 (100=positivo): il marker del "buono"
// sta a sinistra (verde), quello "cattivo" a destra (rosso). ends[0]=sinistra(verde).
/* TERMOMETRO LINEARE unificato (sostituisce i tachimetri semicircolari per compattare la dashboard).
   score 0-100; convenzione: verde a SINISTRA = favorevole (score alto), rosso a destra = sfavorevole.
   opt.direct=true → marker a score% (per Fear&Greed); opt.gradient → gradiente custom. */
function thermoLine(score, ends, opt = {}) {
  const s = Math.max(0, Math.min(100, score ?? 50));
  const pos = opt.direct ? s : 100 - s;
  const gradStyle = opt.gradient ? ` style="background:${opt.gradient}"` : "";
  return `<div class="tl">
    <div class="tl-track"${gradStyle}><span class="tl-marker" style="left:${pos}%"></span></div>
    ${ends ? `<div class="tl-ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>` : ""}
  </div>`;
}

// retrocompatibilità: vecchio thermoBar e compactSemiGauge ora rendono il termometro lineare
function thermoBar(score, ends) { return thermoLine(score, ends); }
function compactSemiGauge(score, ends) { return thermoLine(score, ends); }

/* card termometro uniforme e compatta; score 0-100 (100=positivo/verde, a sinistra). key per il popup */
function thermoCard(key, title, score, valueText, subText, ends) {
  const s = Math.max(0, Math.min(100, score ?? 50));
  const col = scoreColor(s);
  return `<div class="gauge-card" data-gauge="${key}" tabindex="0" role="button" title="Clicca per dettagli e news">
    <span class="popup-dot"></span>
    <div class="g-title">${title}</div>
    <div class="gauge-value" style="color:${col}">${valueText}</div>
    ${thermoLine(s, ends)}
    <div class="gauge-sub">${subText}</div>
  </div>`;
}

/* Fear & Greed come termometro lineare (paura=rosso sx, avidità=verde dx, marker diretto su score) */
function fgGaugeCNN(score) {
  const s = Math.max(0, Math.min(100, score));
  const col = s >= 55 ? "var(--green)" : s >= 45 ? "var(--yellow)" : "var(--red)";
  return `<div class="gauge-value" style="color:${col}">${Math.round(s)}</div>
    ${thermoLine(s, ["Paura", "Avidità"], { direct: true, gradient: "linear-gradient(90deg,#d23b30,#eab308,#16a34a)" })}`;
}

/* ---------------- macro ---------------- */
function marketImpact(m) {
  // variazione giornaliera → impatto 0-100 (rendimenti in pp: salita = restrittivo)
  if (m.change_pct === null || m.change_pct === undefined) return null;
  if (m.suffix === " pp") return Math.round(Math.max(0, Math.min(100, 50 - m.change_pct * 300)));
  return Math.round(Math.max(0, Math.min(100, 50 + m.change_pct * 12)));
}


/* ---------------- top ETF dashboard ---------------- */
function etfOpportunity(rsi) {
  if (rsi == null) return { label: "—", color: "var(--muted)" };
  if (rsi < 35) return { label: "Ipervenduto — possibile ingresso", color: "var(--green)" };
  if (rsi < 48) return { label: "Zona neutro-bassa — da monitorare", color: "var(--yellow)" };
  if (rsi < 65) return { label: "Momentum positivo", color: "var(--muted)" };
  return { label: "Ipercomprato — attendere ritracciamento", color: "var(--red)" };
}

/* ---------------- news ---------------- */
function timeAgo(iso) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${mins} min fa`;
  if (mins < 1440) return `${Math.round(mins / 60)} h fa`;
  return `${Math.round(mins / 1440)} gg fa`;
}

const TOPIC_LABEL = t => t === "MACRO" ? "Macro" : t === "POL" ? "Politica" : t;

/* sintesi globale di tutte le news: tono complessivo, conteggi, titoli più citati */
function newsSummary(list) {
  const ptf = new Set([...(DATA.portfolio || []), ...(DATA.watchlist || [])].map(r => r.ticker));
  let bull = 0, bear = 0, neu = 0;
  const tkCount = {}, tkTone = {};
  list.forEach(n => {
    const s = n.sentiment;
    if (s === "bull") bull++; else if (s === "bear") bear++; else neu++;
    (n.tickers || []).forEach(tk => {
      tkCount[tk] = (tkCount[tk] || 0) + 1;
      tkTone[tk] = (tkTone[tk] || 0) + (s === "bull" ? 1 : s === "bear" ? -1 : 0);
    });
  });
  const tot = list.length || 1;
  const net = bull - bear;
  const tone = net >= 3 ? { t: "COSTRUTTIVO", c: "var(--green)" }
    : net <= -3 ? { t: "CAUTO / RISK-OFF", c: "var(--red)" }
    : { t: "MISTO / NEUTRO", c: "var(--yellow)" };
  // titoli del portafoglio più citati, con tono
  const top = Object.entries(tkCount)
    .filter(([tk]) => ptf.has(tk))
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([tk, c]) => {
      const tone = tkTone[tk] > 0 ? "pos" : tkTone[tk] < 0 ? "neg" : "muted";
      return `<span class="ns-chip ${tone}">${tk} <b>${c}</b>${tkTone[tk] > 0 ? " ▲" : tkTone[tk] < 0 ? " ▼" : ""}</span>`;
    }).join("");
  return { bull, bear, neu, tot, tone, top };
}

function renderNewsSummary(list) {
  const box = $("#news-summary");
  if (!box) return;
  if (!list.length) { box.innerHTML = ""; return; }
  const s = newsSummary(list);
  const pct = v => Math.round(v / s.tot * 100);
  // riga unica e compatta: tono + barra + conteggi (dettaglio completo nel popup)
  box.innerHTML = `
    <div class="ns-line">
      <b style="color:${s.tone.c}">${s.tone.t}</b>
      <span class="ns-bar" title="positive ${s.bull} · neutre ${s.neu} · negative ${s.bear}">
        <span class="ns-seg ns-bull" style="width:${pct(s.bull)}%"></span>
        <span class="ns-seg ns-neu" style="width:${pct(s.neu)}%"></span>
        <span class="ns-seg ns-bear" style="width:${pct(s.bear)}%"></span>
      </span>
      <span class="ns-counts muted"><span class="pos">▲${s.bull}</span> <span class="neg">▼${s.bear}</span> · ${s.tot} news ›</span>
    </div>`;
}

function renderNews() {
  // solo notizie delle ultime 24 ore (oltre a quanto già filtrato dalla pipeline)
  const cutoff = Date.now() - 26 * 3600 * 1000;
  let list = (DATA.news || []).filter(n => !n.published || new Date(n.published).getTime() >= cutoff);
  if (!list.length) list = DATA.news || [];   // fallback: se tutte vecchie, mostra comunque
  renderNewsSummary(list);
  $("#news-list").innerHTML = list.length ? list.map(n => `
    <li class="news-item">
      <a href="${esc(n.link)}" target="_blank" rel="noopener" title="${esc(n.title)}">${esc(n.title_it || n.title)}</a>
      <div class="news-meta">
        <span class="news-src ${n.source === "Polymarket" ? "src-poly" : ""}">${esc(n.source)}</span>
        <span class="news-time">${timeAgo(n.published)}</span>
        ${n.tickers.map(t => `<span class="news-tk">${TOPIC_LABEL(t)}</span>`).join("")}
      </div>
    </li>`).join("") : '<li class="muted">Nessuna news recente</li>';
}


/* ---------------- prompt AI ---------------- */
/* ██████████████████████████████████████████████████████████████████████████████████
   🛑🛑🛑  STOP! NON MODIFICARE IL TESTO DEL PROMPT (LA TESTATA) IN QUESTO FILE.  🛑🛑🛑
   ██████████████████████████████████████████████████████████████████████████████████
   LA TESTATA È STATA DISACCOPPIATA (v101). Il testo delle ISTRUZIONI all'AI vive NEL FILE:
        ►►►  config/prompt_header.txt  ◄◄◄
   Per cambiare le istruzioni dell'AI EDITA QUEL FILE, non questo. La costante
   DEFAULT_PROMPT_HEADER qui sotto è SOLO il fallback offline (usato al primo caricamento o
   senza rete): NON deve coincidere col file — il file è la fonte di verità ed è editato
   dall'utente dalla UI ("⚙ Impostazioni Prompt"), che lo scrive via GitHub Contents API e
   lo ricarica con loadPromptHeaderCloud(). 🛑 NON sovrascrivere MAI config/prompt_header.txt
   a mano (cancelleresti le personalizzazioni del CEO). Modifica DEFAULT_PROMPT_HEADER solo
   se vuoi cambiare il fallback offline, non per "allinearlo" al file.
   La "CODA" (payload dati: tabelle/macro/news/fondamentali/portafoglio) è generata dalle
   funzioni JS piu sotto e NON va toccata/semplificata. Vedi CLAUDE.md nella root.
   ██████████████████████████████████████████████████████████████████████████████████ */
const PROMPT_HEADER_PATH = "config/prompt_header.txt";
const DEFAULT_PROMPT_HEADER = `RUOLO: Sei il Comitato di Investimento Senior (analisti quantitativi, fondamentali e macro) di un fondo Growth. Riporti all'Amministratore Delegato (l'utente). Non sei un esecutore di format: sei un comitato di Wall Street che pensa. Esponi i fatti, i conflitti tra matematica e mercato, e le tue raccomandazioni — l'ultima parola spetta al CEO.

DELEGA PIENA SULLA FORMA: decidi TU come strutturare il report — numero di sezioni, ordine, formato e lunghezza — in base a ciò che i dati di oggi meritano: un giorno denso di news e violazioni merita un report ricco; una domenica piatta merita poche righe oneste, non riempitivi. Se qualcosa non ti torna — una strategia ambigua, un dato contraddittorio, un'intenzione del CEO che non conosci — FAI DOMANDE invece di assumere.

MANDATO DI CONSEGNA MINIMA (NON è una gabbia sulla forma, è il contenuto che il report DEVE contenere, comunque tu decida di organizzarlo — non "dimenticarlo" per fare narrativa macro):
A. INDICI LEADING: leggi SEMPRE, anche in poche righe, lo stato di KOSPI (^KS11), Nasdaq Composite (^IXIC) e Bitcoin (BTC-USD) come anticipatori — il KOSPI chiude prima dell'apertura USA (proxy del sentiment tech/semiconduttori), Bitcoin è il termometro dell'appetito al rischio globale e ha correlazione diretta con MSTR/nomi ad alta beta. Se sono nel payload, NON ignorarli.
B. ESECUZIONE COMPLETA: per OGNI operazione suggerita (COMPRA o VENDI) fornisci il calcolo della quantità di quote e mostralo (es. "12.000$ ÷ prezzo 180$ = 66 quote"). Il payload pubblica la liquidità disponibile come FATTO, non un tetto di spesa: quanto impegnarne è una decisione tua, da dichiarare insieme alla ragione. Non ricostruire vincoli che il sistema non impone.
Per gli ORDINI di VENDITA o TRIM: rispetta le proporzioni matematiche fornite dal payload (quote possedute, MCR, stop, pesi) — NON inventare liquidazioni totali della posizione se non sono supportate dalla gestione del rischio.
C. INCROCIO CON LE NEWS SPECIFICHE: il payload contiene NEWS PER SINGOLO TITOLO (catalizzatori micro). Incrociale con la tecnica e i fondamentali di QUEL titolo — non liquidarle con un riassunto macro generico. Se una raccomandazione poggia su una notizia, cita quale. MAI inventare un catalizzatore che non è nel payload.
D. GAP PRE/AFTER-MARKET: la colonna Pre/After mostra dove scambia il titolo FUORI dalla sessione ufficiale. Quando il dato esiste, usalo per calibrare il limite ed EVITA esplicitamente i gap in apertura; quando manca, dichiaralo come incognita.

BRIEFING SUI PROBLEMI NOTI DEL SISTEMA (osservazioni strategiche, NON divieti assoluti):
1. LATENZA MACRO: usa la ricerca web per fare double-check sui dati flaggati come datati o inaffidabili.
2. LIQUIDITÀ E RISCHIO CAMBIO: mantenere cassa per i ribassi è una scelta strategica, non un obbligo del sistema. Valuta che impiegare liquidità su asset USA aumenta il rischio di cambio non coperto quando l'Euro è forte.
3. LET WINNERS RUN E MCR: Non siamo un fondo regolamentato: non c'è NESSUN obbligo di vendere se un titolo supera il 10% del NAV. Lascia correre i profitti sulle aziende eccellenti. Usa il 10% e l'MCR solo per far riflettere il CEO sulla volatilità, non come divieti imperativi.
4. CONCENTRAZIONE SETTORIALE (IL PARADOSSO DIVERSIFICAZIONE): Se suggerisci un acquisto forte (es. SNDK) ma il fondo ha già posizioni enormi nello stesso settore (es. MU), NON omettere il suggerimento, ma fai NOTARE esplicitamente al CEO che l'operazione aumenterebbe la concentrazione settoriale e annullerebbe la diversificazione. Il trade va esposto, la scelta resta al CEO.
5. IGIENE DEI DATI E ISTRUZIONI: "n.d." = dato non disponibile, non inventarlo. Preferisci ordini LIMITE.

Sii proattivo e spietato sui rischi: se vedi un problema che il CEO non ti ha chiesto di guardare, sollevalo tu.`;
function promptHeaderText() {
  const ov = localStorage.getItem("prompt_header");
  return (ov && ov.trim()) ? ov : DEFAULT_PROMPT_HEADER;
}
/* v141: savePromptHeader/pushPromptHeaderCloud rimosse con l'editor UI — la testata
   (Costituzione) si scrive via repo; il client la LEGGE soltanto (loadPromptHeaderCloud). */
/* POST equivalente: sovrascrive config/prompt_header.txt via GitHub Contents API */
/* GET equivalente: legge la testata server-side e la usa come override (server vince) */
async function loadPromptHeaderCloud() {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${PROMPT_HEADER_PATH}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const txt = (await r.text()).trim();
    if (txt && txt !== DEFAULT_PROMPT_HEADER.trim()) localStorage.setItem("prompt_header", txt);
    else localStorage.removeItem("prompt_header");   // server allineato al default -> nessun override
  } catch { /* offline: resta l'eventuale override locale */ }
}

function buildPrompt() {
  const t = DATA.totals;
  const m = DATA.macro || {};
  const dqV = validateMacroData();   // data assertions: usata da indicatori, margin debt e report
  const lines = [];
  // difensivo: eur_invested lo calcola recomputeTotals (gira in renderAll prima di qui). Se per
  // qualsiasi motivo mancasse, ripiego su eur_value del payload — mai "NaN €" verso l'AI.
  const patrimonio = Number.isFinite(t.eur_invested + cashEur) ? t.eur_invested + cashEur : (t.eur_value ?? 0);
  // 🛑 TESTATA: viene da config/prompt_header.txt (via promptHeaderText). NON scrivere qui il
  //    testo delle istruzioni — editalo in config/prompt_header.txt. Coda dati INTATTA sotto. 🛑
  lines.push(promptHeaderText());
  lines.push("");
  // SEGNALE DI SHOCK (v145): NON è più una DIRETTIVA che ordina di sospendere gli acquisti — era
  // un dettame in contrasto con la filosofia "indicatori non dettami". Ora è EVIDENZA con un
  // workflow di verifica INLINE (v156: prima citava "A4", sezione della testata che la slim-down
  // v155 a 3 limiti ha rimosso → riferimento pendente; il workflow è auto-contenuto qui sotto):
  // la conferma incrociata USA (futures) è servita nel testo, se gli USA non confermano la caduta
  // asiatica il CIO la declassa a evento localizzato invece di congelarsi.
  const shock = (DATA.macro || {}).shock_alert;
  if (shock && shock.active) {
    const fut = (DATA.macro || {}).futures || {};
    const futBits = [fut.nasdaq, fut.sp500].filter(f => f && f.change_pct != null)
      .map(f => `${f.label || f.symbol || "Fut"} ${signTxt(f.change_pct)}`).join(" · ");
    const futLine = futBits
      /* v226 — era un ORDINE nella coda ("dichiaralo al CEO e procedi normalmente"), e il gate
         C9 lo prendeva ogni volta che il ramo shock si attivava — cioè raramente, quindi era
         rimasto a lungo invisibile (la classe v190: un difetto in un ramo raro non è raro, è
         solo non letto). Ora la riga AFFERMA il fatto: le istruzioni vivono nella testata. */
      ? `Conferma incrociata USA (dato più fresco, ha PRIORITÀ sull'Asia): ${futBits}. Futures USA verdi o piatti mentre l'Asia crolla = ALLARME FANTASMA localizzato all'Asia, cioè una caduta che il mercato di riferimento di questo libro non ha confermato.`
      : `Conferma incrociata USA: i futures non sono nel payload, quindi la caduta asiatica resta senza controprova sul mercato che conta per questo libro.`;
    lines.push(`🚨 [SEGNALE DI SHOCK — verifica prima di agire, NON è un ordine]: ${shock.sources.map(s => `${s.src} ${signTxt(s.chg)}`).join(" · ")} (oltre ${shock.threshold}% con Wall Street chiusa). È un INDIZIO da validare, non un verdetto. WORKFLOW DI VERIFICA in ordine: 1) conferma il dato (Tabella B/web) · 2) escludi cache/feed rotto · 3) ${futLine} · 4) cosa cambia se il regime è confermato: i livelli d'ingresso e i target di questo payload sono calcolati su prezzi PRE-shock, e gli stop 2×ATR sono misurati su una volatilità che non contiene il gap atteso — due numeri costruiti su un mercato che potrebbe non esistere più all'apertura. Questo blocco è un INDIZIO, non una sospensione automatica.`);
    lines.push("");
  }
  // ORDINE WEB-SEARCH IN CIMA: se ci sono dati mancanti/inaffidabili, l'imperativo va visto
  // PRIMA di tutto il resto (l'LLM tende a "dimenticarlo" se sepolto in fondo al payload)
  if ((dqV.bad || []).length) {
    lines.push(`⚠⚠ PRIMO ORDINE OPERATIVO (esegui PRIMA di scrivere l'analisi): questi dati macro sono MANCANTI o INAFFIDABILI nel payload → [${dqV.bad.map(b => b.key).join(", ")}]. Usa OBBLIGATORIAMENTE la ricerca web per reperirne il valore reale corrente (cita valore, fonte e data per ciascuno) e usali per la lettura di leva finanziaria e valutazioni. Se la ricerca non li recupera, lasciali mancanti ma dichiaralo e tienine conto — non trattarli come zero.`);
    lines.push("");
  }
  const ageMin = Math.round((Date.now() - new Date(DATA.updated_at).getTime()) / 60000);
  const lagNote = ageMin > 90 ? ` [ATTENZIONE: snapshot di ${ageMin >= 120 ? Math.round(ageMin / 60) + " ore" : ageMin + " min"} fa — i prezzi potrebbero essere disallineati dal mercato live; verifica online i livelli critici prima di ragionarci sopra]` : "";
  lines.push(`DATI AL ${new Date(DATA.updated_at).toLocaleString("it-IT")} (prezzi: snapshot pipeline + refresh live lato client ogni 60s)${lagNote}`);

  /* ⚠ v245 — SE IL PORTAFOGLIO E' INCOMPLETO, L'LLM DEVE SAPERLO PRIMA DI TUTTO IL RESTO.
     Il 07/08/2026 il payload girava su 8 azioni mentre il CEO ne aveva 12: quattro acquisti
     annotati nel diario non erano mai stati applicati, perche' l'unica via di passaggio era un
     `confirm()` che si puo' chiudere. Un'analisi su un terzo di portafoglio mancante non e'
     imprecisa: e' sbagliata, e sembra corretta — che e' la combinazione peggiore.
     Questo blocco sta SUBITO SOTTO la data, prima di ogni altro numero, perche' cambia il
     significato di tutti quelli che seguono: pesi, concentrazione, budget, alpha. */
  try {
    const dv = divergenzaDiario();
    if (dv.needed && dv.certe.length) {
      lines.push(`🚨 PORTAFOGLIO INCOMPLETO — ATTENZIONE PRIMA DI OGNI CALCOLO: il diario del CEO registra ${dv.certe.length} acquisto/i che NON sono nelle tabelle qui sotto: ${dv.certe.map(x => `${x.ticker} ${x.qty ?? "?"} quote a ${x.prezzo ?? "?"} del ${x.iso}`).join(" · ")}. TUTTI i numeri che dipendono dalla composizione — pesi sul NAV, concentrazione di fattore, quota di varianza, budget operativo, alpha, correlazioni — sono calcolati SENZA queste posizioni e quindi NON descrivono il portafoglio reale. Finche' la divergenza esiste, quei numeri descrivono un portafoglio diverso da quello reale.`);
    } else if (dv.needed && dv.daVerificare.length) {
      lines.push(`⚠ DIARIO E TABELLE DA VERIFICARE: ${dv.daVerificare.map(x => x.motivo).join(" · ")}. Potrebbero essere operazioni parziali gia' applicate; non e' certo che manchi qualcosa.`);
    }
  } catch { /* il payload non deve mai rompersi per un controllo accessorio */ }
  // CONTESTO DI SESSIONE (v149): la fase della seduta USA calcolata ADESSO (client), non al
  // run pipeline — orienta l'LLM su quali dati sono "il presente" (anticipatori vs live) e
  // per QUALE campana valgono gli ordini. Vedi usSessionInfo/sessionContextLine.
  lines.push(sessionContextLine());
  // v186 — PREZZI DA SEDUTE DIVERSE. Yahoo pubblica la barra giornaliera in tempi diversi per
  // titoli diversi (gotcha gia' noto: "barra odierna voidata"), e nei run successivi di un
  // weekend il portafoglio si popola A PEZZI: il 26/07 quattro posizioni erano ancora alla
  // chiusura del 23 e sei erano gia' passate al 24. Ogni RIGA lo dichiarava onestamente
  // ("[chiusura del 23/07]"), ma gli AGGREGATI no — e patrimonio, pesi NAV, Sharpe, VaR/ES,
  // MCR e alpha erano calcolati su un book che a nessun istante e' esistito davvero.
  // Conseguenza vista sul campo: RGTI e' entrato fra gli stop violati fra due run domenicali
  // solo perche' la sua barra del 24 e' arrivata, non perche' il prezzo si fosse mosso.
  // Questo e' un FATTO sui dati, non un'istruzione: sta nel payload, non nella testata.
  const asof = (DATA.portfolio || []).filter(r => r.qty && r.currency !== "EUR" && r.price_asof)
    .reduce((m, r) => m.set(r.price_asof, (m.get(r.price_asof) || 0) + 1), new Map());
  if (asof.size > 1) {
    const per = [...asof.entries()].sort((a, b) => b[0].localeCompare(a[0]))
      .map(([d, n]) => `${n} al ${new Date(d + "T00:00:00").toLocaleDateString("it-IT").slice(0, 5)}`).join(" · ");
    lines.push(`⚠ PREZZI DA SEDUTE DIVERSE: le posizioni non sono tutte alla stessa chiusura (${per}). `
      + `La pipeline riceve la barra giornaliera in tempi diversi per titoli diversi, quindi il book si popola a pezzi. `
      + `Patrimonio, pesi NAV, Sharpe, VaR/ES, MCR e alpha qui sotto sono calcolati su questo insieme MISTO — `
      + `nessun istante in cui il portafoglio abbia avuto davvero questi valori tutti insieme. `
      + `Anche l'appartenenza alla lista degli stop violati puo' dipendere da quale seduta e' arrivata per quel titolo.`);
  }
  /* ⚠ v253 — IL LIBRO IN QUESTO PACCHETTO PUÒ ESSERE INDIETRO, E FINORA NON LO DICEVA.
     Trovato eseguendo il payload su me stesso: `config/holdings.json` aveva 12 posizioni e il
     pacchetto ne portava 9. Non era un difetto di calcolo — la pipeline gira su cron e non
     aveva ancora rigenerato — ma l'LLM riceveva un book amputato di un terzo SENZA UN SEGNO
     che lo fosse, e ha analizzato quel book come se fosse completo. È la stessa classe di
     ⚠ PREZZI DA SEDUTE DIVERSE (v186): non si può correggere il ritardo, si può DICHIARARLO.
     La fonte è il diario, che vive nel repo e non dipende dal cron: un'operazione marcata
     `applicata` è già dentro holdings.json per costruzione, quindi se il suo titolo non
     compare qui, la differenza è esattamente il ritardo della pipeline. Si azzera da solo al
     run successivo. FATTO, non istruzione (C9). */
  try {
    const inPtf = new Set((DATA.portfolio || []).map(r => String(r.ticker || "").toUpperCase()));
    const asOf = (DATA.broker || {}).as_of || null;
    const mancanti = new Map();
    for (const e of (typeof loadDiary === "function" ? loadDiary() : [])) {
      if (!e || !e.applicata) continue;
      const iso = String(e.date || "").slice(0, 10);
      if (asOf && iso && iso <= asOf) continue;
      const o = (typeof diaryOp === "function") ? diaryOp(e) : null;
      if (!o || !o.ticker || !/ACQUIST|COMPR|INCREMENT|ACCUMUL|AGGIUNT/i.test(o.tipo || "")) continue;
      const tk = String(o.ticker).toUpperCase();
      if (!inPtf.has(tk)) mancanti.set(tk, o.qty != null ? `${tk} (${fmtNum.format(o.qty)})` : tk);
    }
    if (mancanti.size) {
      lines.push(`⚠ LIBRO INCOMPLETO IN QUESTO PACCHETTO: ${mancanti.size} `
        + `${mancanti.size === 1 ? "acquisto già registrato nel portafoglio non compare" : "acquisti già registrati nel portafoglio non compaiono"} `
        + `nei dati di questo run — ${[...mancanti.values()].join(", ")}. La pipeline dati gira a intervalli e non ha ancora rigenerato: `
        + `il portafoglio reale ha ${(DATA.portfolio || []).filter(r => r.qty).length + mancanti.size} posizioni, le tabelle qui sotto ne mostrano `
        + `${(DATA.portfolio || []).filter(r => r.qty).length}. Patrimonio, pesi NAV, MCR, correlazioni e concentrazione di fattore sono calcolati `
        + `SENZA i titoli elencati, quindi sottostimano l'esposizione ai loro settori.`);
    }
  } catch { /* il payload non deve mai rompersi per un controllo accessorio */ }
  const cashLine = t.cash ? ` · liquidità ${fmtEUR.format(t.cash)}` : "";
  lines.push(`SITUAZIONE PATRIMONIALE: patrimonio totale ${fmtEUR.format(Math.round(patrimonio))}${cashLine} · capitale investito (costo) ${fmtEUR.format(t.eur_cost ?? t.eur_invested)} · guadagno lordo ${signTxt(Math.round(t.eur_gain), " €")} (${signTxt(Math.round(t.eur_gain_pct * 100) / 100)})${t.eur_gain_net != null ? ` · netto tasse stimato ${signTxt(Math.round(t.eur_gain_net), " €")}` : ""}.`);
  // METRICHE DI RISCHIO/PORTAFOGLIO (dai popup della dashboard)
  const riskBits = [];
  if (t.portfolio_sharpe_ratio != null) riskBits.push(`Sharpe Ratio portafoglio ${fmtNum.format(t.portfolio_sharpe_ratio)} (log-rendimenti giornalieri 12M, matrice di covarianza, pesi mark-to-market, Rf ${fmtNum.format((t.risk_free_rate ?? 0.0363) * 100)}%)`);   // v247: il "target 2.0" veniva da Gemini, non dal CEO
  if (t.portfolio_sortino_ratio != null) riskBits.push(`Sortino Ratio ${fmtNum.format(t.portfolio_sortino_ratio)} (come lo Sharpe ma con la sola volatilità NEGATIVA: se Sortino >> Sharpe, gran parte della varianza è al rialzo — rischio "vero" più basso di quanto lo Sharpe suggerisca)`);
  {
    const vE = t.var95_hist_eur ?? t.var95_1d_eur, vP = t.var95_hist_pct ?? t.var95_1d_pct;
    const eE = t.es95_hist_eur ?? t.es95_1d_eur;
    const isHist = t.var95_hist_eur != null;
    /* v247 — RIMOSSI VaR ed Expected Shortfall dal payload (scelta del CEO): erano il divisore
       del BUDGET OPERATIVO, cioè il vincolo di spesa. Volatilità e correlazioni restano qui sotto,
       perché sono misure e non tetti. */
  }
  if (t.avg_pairwise_corr != null) riskBits.push(`correlazione media tra le posizioni: ${fmtNum.format(t.avg_pairwise_corr)} (log-rendimenti giornalieri 12M, calcolata sul SOLO comparto azionario — BTP e liquidità NON sono nel calcolo, quindi non la "mitigano"; più è alta, minore la diversificazione reale)`);
  const fxP = fxExposure();
  if (fxP) riskBits.push(`Rischio cambio EUR/USD: ${fmtNum.format(fxP.pct)}% del NAV denominato in USD NON coperto${fxP.eurusd ? ` (EUR/USD ${fmtNum.format(fxP.eurusd)})` : ""} — un apprezzamento dell'euro dell'1% costa ~${fmtEUR.format(Math.round(fxP.usdEur * 0.01))} a parità di prezzi`);
  // concentrazione: posizione più pesante e primo settore (per le regole di sizing/correlazione)
  const wPos = (DATA.portfolio || []).map(r => ({ tk: r.ticker, w: positionWeightPct(r), eq: isEquity(r) })).filter(x => x.w != null).sort((a, b) => b.w - a.w);
  if (wPos.length) {
    // Soglia = il cap d'ingresso REALE del motore (RISK_PARAMS.capNoAdd_pct, override-abile dalla
    // dashboard), NON un 10% hardcoded. Prima la riga diceva "SOPRA il limite del 10%" mentre il
    // motore usava un cap diverso (es. 15%): un nome tra 10% e il cap risultava "sopra il limite"
    // QUI ma restava candidato → contraddizione. E il cap vale sulle sole EQUITY (universo
    // dell'accumulo): il BTP a beta 0 non si "accumula", quindi NON va nella lista over-cap.
    const cap = RISK_PARAMS.capNoAdd_pct;
    const overCapPos = wPos.filter(x => x.eq && x.w > cap);
    riskBits.push(`posizione più pesante: ${wPos[0].tk} ${fmtNum.format(wPos[0].w)}% del NAV`);   /* v247 — resta il PESO (misura); via l'elenco "SOPRA il cap d'ingresso", ultimo divieto rimasto */
  }
  const allocR = DATA.allocation || [];
  if (allocR.length) {
    const totA = allocR.reduce((s, a) => s + (a.value_eur || 0), 0) || 1;
    const bySecR = {};
    // v118 — la regola di CONCENTRAZIONE settoriale misura il rischio CORRELATO: base = solo
    // capitale AZIONARIO (liquidità E obbligazioni escluse — il BTP è beta 0, non fa parte
    // del book correlato). Prima la base includeva le obbligazioni ("dell'investito") e dava
    // una % diversa da "Concentrazione per settore" (patrimonio totale) → l'LLM la leggeva
    // come incoerenza. Ora le due cifre hanno denominatori ESPLICITI e distinti.
    allocR.filter(a => a.sector !== "Liquidità" && a.sector !== "Obbligazioni")
          .forEach(a => { const k = a.sector || a.ticker; bySecR[k] = (bySecR[k] || 0) + (a.value_eur || 0); });
    const invTot = Object.values(bySecR).reduce((s, v) => s + v, 0) || 1;
    const topSec = Object.entries(bySecR).sort((a, b) => b[1] - a[1])[0];
    // v174 — due allarmi settoriali su BASI DIVERSE (questo sul PESO, factorRiskAlert_pct sulla
    // VARIANZA) si confondevano a vicenda: due campanelli sulla stessa cosa che suonano a soglie
    // non confrontabili. Il peso resta come CONTESTO — dice quanto capitale c'è — ma il giudizio
    // di concentrazione passa alla varianza, che è dove questo book è asimmetrico (56% di NAV in
    // semi vale l'86% del rischio). Un solo allarme, sulla grandezza che fa male.
    if (topSec) riskBits.push(`primo settore: ${topSec[0]} ${Math.round(topSec[1] / invTot * 100)}% del capitale AZIONARIO (quota di CAPITALE, non di rischio: il giudizio sulla concentrazione lo dà la CONCENTRAZIONE DI FATTORE nel verdetto, che ragiona sulla VARIANZA — su un book a beta disomogenee le due grandezze divergono molto)`);
    void totA;
  }
  if (cashEur > 0 && patrimonio > 0) {
    const cFrac = cashEur / patrimonio;
    riskBits.push(`Liquidità infruttifera: ${(cFrac * 100).toFixed(1)}% del patrimonio a rendimento 0 (drag strutturale sul rendimento composto e sullo Sharpe complessivo)`);
  }
  if (t.budget_operativo_spendibile != null && (t.es95_hist_eur ?? t.es95_1d_eur) != null) {
    const esAbs = t.es95_hist_eur ?? t.es95_1d_eur;
    const bud = Math.round(t.budget_operativo_spendibile);
    if (bud <= 0) {
      // Budget clampato a 0 (cassa < ES95): NON stampare la falsa equazione "0 = X − Y" (era
      // "0 € = liquidità 0 € − ES95 12.469 €", un'uguaglianza matematicamente falsa che l'LLM
      // legge male) e METTI UN PRESIDIO A1: un LLM con contesto sporco tende a riportare cassa/
      // budget del run precedente (visto: Gemini ha usato 17.531 €/30.000 € con cassa 0).
      riskBits.push(`⛔ BUDGET OPERATIVO SPENDIBILE: 0 € — la cassa (${fmtEUR.format(Math.round(cashEur))}) NON copre la riserva tail-risk ES95 (${fmtEUR.format(esAbs)}), quindi ZERO potere d'acquisto oggi. NESSUN ordine di ACQUISTO è eseguibile. Ignora qualsiasi importo di cassa o budget di run/conversazioni precedenti (regola A1): oggi vale 0, punto`);
    } else {
      /* v247 — RIMOSSO il BUDGET OPERATIVO SPENDIBILE: amputava un quarto della cassa prima
         ancora di guardare un titolo. La LIQUIDITÀ resta pubblicata: è un fatto, non un tetto. */
    }
  }
  if (riskBits.length) lines.push("METRICHE DI RISCHIO: " + riskBits.join(" · ") + ".");
  // riconciliazione broker: se i dati manuali sono stantii/incoerenti l'AI deve saperlo
  try {
    const rec = reconcileState();
    if (rec.needed) {
      const bits = [];
      if (rec.staleDays != null && rec.staleDays > 14) bits.push(`snapshot broker vecchio di ${rec.staleDays} giorni (${(DATA.broker || {}).as_of})`);
      if (rec.mismatches.length) bits.push(`controvalore ricalcolato che diverge >20% dal bval broker su: ${rec.mismatches.map(m => `${m.tk} ${m.dev > 0 ? "+" : ""}${m.dev}%`).join(", ")}`);
      lines.push(`⚠ RICONCILIAZIONE BROKER NECESSARIA (${bits.join("; ")}): i campi statici del broker potrebbero non riflettere trade recenti. I valori RICALCOLATI (prezzo live × quantità) e quelli dello snapshot broker possono quindi divergere, e in questo payload le due fonti convivono.`);
    }
  } catch { /* no-op */ }
  // STAGIONALITÀ del mese corrente
  if (m.seasonality && m.seasonality.score != null) {
    const se = m.seasonality;
    const cm = MONTH_NAMES[(se.current_month || 1) - 1];
    // v189 — QUANDO IL MESE STA FINENDO, LA STAGIONALITÀ DEL MESE CORRENTE È GIÀ SPESA.
    // Il 26/07 restavano tre sedute di luglio e il payload pubblicava solo "STAGIONALITÀ
    // (Luglio): 75/100 Favorevole": un contesto di probabilità che vale per il passato mentre
    // gli ordini valgono per le settimane successive. I dati del mese seguente sono GIÀ in
    // data.json (serie a 12 mesi), non serviva altro che leggerli. Si aggiunge solo negli
    // ultimi giorni del mese: prima sarebbe rumore.
    const gg = new Date();
    const ultimoDelMese = new Date(gg.getFullYear(), gg.getMonth() + 1, 0).getDate();
    const restano = ultimoDelMese - gg.getDate();
    let seaProx = "";
    if (restano <= 7 && Array.isArray(se.sp500) && Array.isArray(se.ndx)) {
      const mProx = ((se.current_month || gg.getMonth() + 1) % 12) + 1;
      const sp = se.sp500.find(x => x.m === mProx), nd = se.ndx.find(x => x.m === mProx);
      if (sp || nd) {
        const sc = sp && nd ? Math.round((sp.score + nd.score) / 2) : (sp || nd).score;
        seaProx = ` · ⏭ ${MONTH_NAMES[mProx - 1].toUpperCase()} (mancano ${restano} giorni alla fine del mese, quindi è la finestra che conta per gli ordini di adesso): score ${sc}/100`
          + (sp ? ` · S&P ${sp.score} (media storica ${signTxt(sp.avg)}, positivo nel ${fmtNum.format(sp.pos)}% degli anni su ${sp.n})` : "")
          + (nd ? ` · Nasdaq ${nd.score}` : "");
      }
    }
    lines.push(`STAGIONALITÀ (${cm}): score ${se.score}/100 (${se.label})${se.sp_score != null ? ` · S&P ${se.sp_score}` : ""}${se.ndx_score != null ? ` · Nasdaq ${se.ndx_score}` : ""} ${seaProx} · tendenza statistica storica del mese, da usare come contesto di probabilità.`);
  }
  // SINTESI NEWS (tono complessivo)
  if ((DATA.news || []).length) {
    // v189 — IL TONO SI CALCOLA SULLE NOTIZIE, NON SULLE QUOTAZIONI DI POLYMARKET.
    // DATA.news contiene anche le righe dei mercati di previsione ("… — probabilità Sì 30%"),
    // che hanno sentiment "neutral" per costruzione: finivano nel conteggio del tono gonfiando
    // il denominatore e diluendo il segnale. Il payload dichiarava percio' DUE totali diversi
    // per la stessa grandezza — "48 news" nei catalizzatori (gia' filtrate da isRealNews) e
    // "53 notizie" nella sintesi — senza dire che le basi erano diverse. Stessa classe di
    // HY/IG: due denominatori sotto un nome solo. Ora la base e' UNA, ed e' dichiarata.
    const newsVere = (DATA.news || []).filter(isRealNews);
    const ns = newsSummary(newsVere);
    const scartate = (DATA.news || []).length - newsVere.length;
    lines.push(`SINTESI NEWS: tono ${ns.tone.t} su ${ns.tot} notizie (${ns.bull} positive, ${ns.neu} neutre, ${ns.bear} negative)`
      + (scartate > 0 ? ` — base: le sole notizie vere, escluse ${scartate} righe di mercati di previsione che stanno nel loro blocco (MERCATI DI PREVISIONE) e non hanno un tono giornalistico.` : "."));
  }
  // OUTPUT DEL MOTORE DELLA DASHBOARD — solo DATI di contesto sul posizionamento interno.
  // In modalità standby l'AI NON deve commentarli operativamente né trasformarli in raccomandazioni.
  try {
    const dv = decisionVerdict();
    // ═══ v200 — VIA IL VERDETTO E I PUNTEGGI. Decisione presa sui NUMERI, non sulle opinioni.
    // Il motore pubblicava un'etichetta ("verdetto interno ACCUMULA") e una classifica con
    // punteggi su 100, in cima al payload, dove ancorano chiunque legga. Il track record misurato
    // di quella parte, che il payload pubblica poche righe sotto, e': 7 segnali maturati, ritorno
    // medio -10,8%, sette punti percentuali PEGGIO del Nasdaq, hit-rate 29%. Un numero con quel
    // curriculum, accanto a un avvertimento onesto, ancora lo stesso: l'ancoraggio non si batte
    // con una nota a pie' di pagina, si batte togliendo il numero.
    // COSA RESTA, e non e' poco: stop violati, concentrazione di fattore, livelli d'ingresso,
    // capienze, minusvalenze. Quelle non prevedono nulla — CALCOLANO — e sono la parte del
    // sistema che in questa sessione ha intercettato i difetti arrivati fino alle decisioni.
    // I filtri restano ma tornano a essere FILTRI: chi passa e chi no, con la soglia dichiarata,
    // in ordine alfabetico e senza punteggio. Ordinare e' gia' un giudizio.
    const passa = [...(dv.accumula || [])].map(r => r.ticker).sort();
    const bloccatiCap = [...(dv.overCap || [])].map(x => (x.r || x).ticker).sort();
    lines.push(`FILTRI QUANTITATIVI DELLA DASHBOARD (chi supera le soglie meccaniche, in ordine alfabetico — NESSUN punteggio e NESSUN verdetto: questo blocco non classifica piu' e non consiglia, perche' l'esito misurato di quella classifica e' nel blocco TRACK RECORD DEL MOTORE qui sotto e non giustifica l'autorita' che un punteggio porta con se'):`);
    lines.push(`· Superano tutte le soglie (${passa.length}): ${passa.length ? passa.join(", ") : "nessuno"}`
      /* v247 — RIMOSSO "fermati dal cap d'ingresso": nominava AMD, MU e NVDA — tre delle
         posizioni maggiori del CEO — come bloccate. È il divieto, non la misura. */
      + ""
      + `. I criteri meccanici sono impatto marginale sullo Sharpe di portafoglio, forza relativa 1M vs benchmark e qualita' fondamentale. I dati per giudicarli uno per uno — fondamentali, tecnica, correlazione col book — stanno nelle tabelle.`);
    // ═══ v201 — LA CONCENTRAZIONE DI FATTORE TORNA, come RIGA PROPRIA.
    // Il taglio del v200 se l'era portata via senza che me ne accorgessi: viveva dentro
    // dv.reasons, cioe' nella lista dei motivi del VERDETTO, e togliendo il verdetto e' sparita
    // con lui. E' il fatto di rischio piu' importante di questo portafoglio — l'86% della
    // varianza su un fattore solo — ed e' ARITMETICA, non previsione: esattamente cio' che avevo
    // detto che sarebbe rimasto. Ora vive per conto suo e non dipende piu' da nessun verdetto.
    // Lezione: quando si toglie un contenitore si porta via anche cio' che ci stava dentro per
    // caso. La ricevuta del taglio (C12) esiste per questo, e non copriva questa riga: ora si'.
    if (dv.factorRisk) {
      const fr = dv.factorRisk;
      /* v247 — resta la MISURA (quota di varianza contro peso) e resta la VARIAZIONE col suo
         percentile, che e' misurata sullo storico. Via "oltre la soglia del N%" e l'invito a
         ridurre: quelli erano il verdetto. */
      lines.push(`CONCENTRAZIONE DI FATTORE: ${fr.tk.join("+")} (${fr.name}) generano il ${fmtNum.format(fr.mcr)}% della VARIANZA del fondo con il ${fmtNum.format(fr.w)}% del NAV. I veti guardano un titolo per volta e questo NON lo vedono: sono nomi che possono scendere INSIEME perche' condividono il fattore, per quanto sani siano singolarmente.${(() => {
        // variazione della quota di fattore vs ~7 rilevazioni fa: senza questo numero la regola
        // B4 ("rimetti la riduzione sul tavolo solo se SALE") non sarebbe verificabile dal payload,
        // e un rimando a un dato che non c'è è la classe di difetto che il gate C10 intercetta
        const mh = (DATA.metrics_history || []).filter(m => m?.titles);
        if (mh.length < 2) return "";
        const prima = mh[Math.max(0, mh.length - 8)];
        const q = (punto) => fr.tk.reduce((sum, t) => sum + (punto.titles?.[t]?.mcr ?? 0), 0);
        const q0 = q(prima), q1 = fr.mcr;
        if (!(q0 > 0)) return "";
        const d = Math.round((q1 - q0) * 10) / 10;
        const gg = mh.length - 1 - Math.max(0, mh.length - 8);
        /* ⚠ v230 — "IN AUMENTO" APRIVA LA PORTA A B4 SENZA DIRE QUANTO FOSSE GRANDE. La testata
           riapre la riduzione della concentrazione solo se la quota di varianza sale "in modo
           materiale", e il payload decideva quella parola con una soglia FISSA di 3 pp: sopra 3
           scriveva IN AUMENTO, e l'LLM la leggeva come il trigger. Ma una soglia fissa non sa se
           quel movimento sia ordinario per QUESTA serie — e' il registro fisso che invecchia da
           solo (C10, red team I6). Ora il numero porta il proprio percentile sullo storico: oggi
           +4,2 pp e' il MASSIMO mai osservato (mediana 2,1) e la riga lo dice. La difesa non
           addolcisce: quando il movimento e' davvero eccezionale lo dichiara, e quando sara'
           ordinario dira' quello. */
        const passi = [];
        for (let i = 7; i < mh.length; i++) passi.push(Math.abs(q(mh[i]) - q(mh[i - 7])));
        passi.sort((u, v) => u - v);
        const perc = passi.length >= 6 ? Math.round(passi.filter(v => v <= Math.abs(d)).length / passi.length * 100) : null;
        const mediana = passi.length >= 6 ? Math.round(passi[Math.floor(passi.length / 2)] * 10) / 10 : null;
        const contesto = perc == null ? " (storico troppo corto per dire se sia un movimento ordinario)"
          : perc >= 90 ? ` — e' il movimento PIU' AMPIO dello storico (${perc}° percentile su ${passi.length} finestre, mediana ${fmtNum.format(mediana)} pp): questo NON e' il livello di sempre, e' un cambiamento`
          : perc <= 60 ? ` — movimento ORDINARIO per questa serie (${perc}° percentile su ${passi.length} finestre, mediana ${fmtNum.format(mediana)} pp): la quota oscilla cosi' di continuo, non e' un fatto nuovo di oggi`
          : ` — movimento nella norma alta (${perc}° percentile su ${passi.length} finestre, mediana ${fmtNum.format(mediana)} pp)`;
        return ` [VARIAZIONE: era ${fmtNum.format(Math.round(q0 * 10) / 10)}% ${gg} rilevazioni fa → ${d > 0 ? "+" : ""}${fmtNum.format(d)} pp${contesto}]`;
      })()}`);
    }
    // NOTA (v156): rimosse da qui le direttive INDIPENDENZA SUL VERDETTO e ANALISI PER-TITOLO —
    // erano una SECONDA testata dentro il payload (il payload deve essere MATERIA PRIMA, non un
    // rulebook che compete con la Costituzione). L'indipendenza vive in [B1], l'analisi per-titolo
    // nelle domande [C], il materiale di rotazione nel blocco CORRELAZIONI + IDEE DI ROTAZIONE.
    lines.push("· NOTA METODOLOGICA: gli Stop Loss sulle posizioni sono TRAILING RATCHET su base 2×ATR(14 Wilder): partono 2×ATR sotto il prezzo e da lì possono solo SALIRE coi massimi — non si riabbassano nei ribassi (persistiti tra i run, reset solo se il trade cambia). NON sono percentuali fisse. Il verdetto di accumulo è ritarato sul mandato quant: impatto marginale sullo Sharpe, forza relativa 1M vs benchmark, qualità fondamentale; gli asset in veto (value trap / ROIC<0 / PEG<0) sono esclusi a prescindere dal supporto tecnico.");
    if ((dv.stopViolations || []).length) {
      // RI-ARM CANDIDATO (v151): la testata chiede "se ri-armi dichiara il NUOVO livello e il
      // rischio in €" ma A1 vieta all'LLM di INVENTARE stop → il livello lo calcola il SISTEMA:
      // stop teorico 2×ATR ancorato al SUPPORTO della riga (sempre < supporto per costruzione),
      // col rischio aggiuntivo già quantificato. BASE = PREZZO CORRENTE, non lo stop violato:
      // il prezzo è GIÀ sotto lo stop ancorato, quindi la perdita stop→prezzo è già maturata e
      // uscendo ora la realizzi comunque. Il rischio che il ri-arm AGGIUNGE è solo quello da
      // "esco adesso al prezzo" fino al nuovo stop = quote × (prezzo − ri-arm). Usare (stop−ri-arm)
      // gonfiava il numero contando una perdita già incassata (v156).
      const eurusdRA = DATA.eurusd || 1.08;
      lines.push("· ⚠ STOP VIOLATI (il prezzo è SOTTO lo stop trailing ancorato — dedica a ciascuno una raccomandazione esplicita (uscire o ri-armare), con motivazione): " +
        dv.stopViolations.map(x => {
          /* ═══ v229 — L'EVENTO PIU' URGENTE CONTRADDETTO DAL PREZZO PIU' FRESCO ══════════
             Trovato leggendo il payload come il ricevente. PLTR era dichiarato STOP VIOLATO sulla
             CHIUSURA ($123,06 sotto lo stop $124,81) mentre il prezzo esteso pre-market era gia'
             a $125,44, cioe' SOPRA lo stop: la violazione era gia' rientrata sul dato piu' fresco
             che lo stesso payload pubblica due righe piu' in la' ("→ agg."). Il blocco che
             impone "una raccomandazione esplicita per ciascuno" chiedeva quindi una decisione
             su un evento che il mercato aveva gia' disfatto.
             E' la classe v193 — stato del mercato e freschezza del dato sono due cose diverse —
             applicata all'evento che il payload tratta come il piu' urgente di tutti.
             NON si cambia la violazione (lo stop e' ancorato alla chiusura, e il ratchet ragiona
             su chiusure): si DICHIARA che l'esteso la contraddice, e di quanto. */
          const ext = x.r.prezzo_limite_aggiustato;
          const rientrato = (ext != null && ext > x.stop && x.r.price < x.stop)
            ? ` [⚠ MA IL DATO PIU' FRESCO LA CONTRADDICE: ${esc(x.r.prepost?.label || "esteso")} $${fmtNum.format(ext)} è SOPRA lo stop $${fmtNum.format(x.stop)} (${signTxt(Math.round((ext / x.stop - 1) * 1000) / 10)}) — sulla chiusura lo stop è violato, sull'ultimo scambio no. La violazione è calcolata sulle CHIUSURE perché il ratchet vive su quelle, ma questa non è ancora una rottura confermata: all'apertura può non esistere]`
            : "";
          const base = `${x.r.ticker} stop $${fmtNum.format(x.stop)} vs prezzo $${fmtNum.format(x.r.price)} (${signTxt(Math.round((x.r.price / x.stop - 1) * 1000) / 10)})${rientrato}`;
          const ra = (x.r.support > 0 && x.r.support < x.r.price) ? atrStop(x.r.support, x.r) : null;
          if (!ra || !(ra.stop > 0) || !(ra.stop < x.r.price)) return base;
          const perShare = x.r.price - ra.stop;
          const riskEur = Math.round(x.r.qty * perShare / eurusdRA);
          // ⚠ v223 — SENZA QUESTO, "STOP VIOLATO" SUONA UGUALE SU TUTTO. Misurato sui dati veri:
          // MU e' violato del 2,6% su una posizione a +839% (lo 0,31% della corsa fatta), PLTR
          // dell'1,4% su una a +8% (il 16,7% della corsa). Il primo e' il ratchet che ha seguito
          // un vincitore fin sotto il prezzo; il secondo e' una tesi che si sta sgretolando. Il
          // payload li presentava IDENTICI, ed e' il motivo per cui il report proponeva di
          // liquidare i cavalli vincenti insieme ai cavalli zoppi.
          const gOra = (x.r.pmc > 0) ? (x.r.price / x.r.pmc - 1) * 100 : null;
          const gStop = (x.r.pmc > 0) ? (x.stop / x.r.pmc - 1) * 100 : null;
          const breach = (x.r.price / x.stop - 1) * 100;
          const quota = (gOra > 0) ? Math.abs(breach) / gOra * 100 : null;
          const scala = (q) => q == null ? ""
            : q < 3 ? " — su questa scala e' RUMORE, non una rottura della tesi: e' il trailing che ha seguito il prezzo fin qui sotto"
            : q > 25 ? " — qui lo stop taglia una quota RILEVANTE del guadagno: e' un evento di tesi, non un sussulto"
            : "";
          /* ═══ v230 — LA PROSPETTIVA PARLAVA DI UN PREZZO CHE NON E' PIU' QUELLO ═════════════
             Misurato su un report reale: l'LLM ha venduto MU (+839%) e AMD (+209%) citando
             "stop violato -4,32% in pre-market". Quel -4,32% e' il GAP pre/chiusura stampato
             nella tabella, mentre la PROSPETTIVA — la difesa che esiste apposta per non
             liquidare i vincitori — era calcolata sulla CHIUSURA e diceva "0,31% della corsa".
             Due numeri sullo stesso titolo, uno vecchio e rassicurante, uno fresco e allarmante:
             l'LLM ha creduto al piu' fresco, ed era ragionevole.
             Ora, quando esiste un prezzo esteso che cambia la lettura, la prospettiva la RIFA su
             quello. Non e' un addolcimento: su AMD la quota passa da 1,79% a ~3,1% e la riga
             smette di dire RUMORE. E' la stessa classe v193 — stato del mercato e freschezza del
             dato sono due cose diverse — applicata al numero che regge la decisione. */
          const pf = x.r.prezzo_limite_aggiustato;
          const usaPf = pf != null && x.r.price > 0 && Math.abs(pf / x.r.price - 1) > 0.005;
          const gPf = (usaPf && x.r.pmc > 0) ? (pf / x.r.pmc - 1) * 100 : null;
          const brPf = usaPf ? (pf / x.stop - 1) * 100 : null;
          /* solo se il prezzo fresco e' ANCORA SOTTO lo stop: se e' sopra, la violazione e'
             rientrata e lo dice gia' la riga "MA IL DATO PIU' FRESCO LA CONTRADDICE" (v229) —
             un secondo periodo che parla di "sfondamento +0,5%" direbbe una cosa senza senso */
          const qPf = (gPf > 0 && brPf < 0) ? Math.abs(brPf) / gPf * 100 : null;
          const suFresco = (qPf != null)
            ? ` RIFATTO SUL PREZZO PIU' FRESCO (${esc(x.r.prepost?.label || "esteso")} $${fmtNum.format(pf)}, che e' il dato su cui deciderai): posizione a ${signTxt(Math.round(gPf))}, sfondamento ${signTxt(Math.round(brPf * 10) / 10)} = ${fmtNum.format(Math.round(qPf * 100) / 100)}% della corsa${scala(qPf)}.`
            : "";
          const prosp = (gOra != null && gStop != null)
            ? ` [PROSPETTIVA: posizione a ${signTxt(Math.round(gOra))} sul PMC; uscire allo stop cristallizzerebbe ${signTxt(Math.round(gStop))}. Lo sfondamento vale il ${quota != null ? fmtNum.format(Math.round(quota * 100) / 100) : "—"}% della corsa fatta finora${scala(quota)}${suFresco ? " ·" + suFresco : ""}]`
            : "";
          return `${base} [ri-arm CANDIDATO se tieni: $${fmtNum.format(ra.stop)} (2×ATR sotto il supporto $${fmtNum.format(x.r.support)}) → rischio aggiuntivo ~€${fmtNum.format(riskEur)} = ${fmtNum.format(x.r.qty)} quote × $${fmtNum.format(Math.round(perShare * 100) / 100)} dal prezzo]${prosp}`;
        }).join(" · ") + ".");
    }
    // ═══ v169 — POSIZIONI CHE CHIEDONO UNA DECISIONE + BUDGET DOPO LE VENDITE ═══════════════
    // Due lacune emerse da un report reale. (1) Le liste che forzano una decisione erano solo
    // "stop violati" e "candidati": un nome in VETO FORTE senza stop violato — MSTR, che ha pure
    // la minusvalenza più grande del book e una falsa accelerazione della RS — non compariva in
    // nessuna, e infatti il report non lo ha nemmeno nominato. (2) Il BUDGET è statico (cassa−ES95)
    // e la regola A3 lo rende vincolante: un piano che VENDE e COMPRA era costretto a sotto-
    // investire, perché i proventi delle vendite proposte non entravano da nessuna parte.
    {
      const eurusdD = DATA.eurusd || 1.08;
      const valEur = (r) => (r.val_eur > 0 ? r.val_eur : (r.qty * r.price) / eurusdD);
      const daDecidere = [];
      const visti = new Set();
      for (const x of (dv.stopViolations || [])) {
        visti.add(x.r.ticker);
        daDecidere.push({ r: x.r, perche: `stop violato ($${fmtNum.format(x.stop)} vs prezzo $${fmtNum.format(x.r.price)})` });
      }
      for (const x of (dv.excluded || [])) {
        const r = x.r;
        if (!r || !r.qty || visti.has(r.ticker) || String(x.strength || "").toLowerCase() !== "forte") continue;
        visti.add(r.ticker);
        daDecidere.push({ r, perche: `VETO FORTE (${(x.why || [])[0] || "value trap"}) su posizione DETENUTA, senza stop violato: nessun evento tecnico la porterà davanti a te da sola` });
      }
      /* v247 — RIMOSSI "🔷 POSIZIONI DA GUARDARE" e "💧 CAPITALE IMMOBILIZZATO": l'elenco che
         il CEO ha citato per primo. Cinque nomi in fila, ognuno con veto, soglia superata e
         minusvalenza pronta all'uso — un LLM che legge quella lista produce l'unica risposta
         che la forma suggerisce. ⚠ NESSUNA MISURA È PERSA: lo stop violato resta nella riga
         degli stop, il Sortino è una COLONNA di Tabella A, il controvalore pure. */
    }
    if ((dv.withPlan || []).length) {
      // v228 — stesso ordine alfabetico del blocco FILTRI: qui l'ordine per punteggio era
      // l'ultimo residuo della classifica rimossa in v200 (vedi la nota nel brief).
      lines.push("· Livelli calcolati dal motore (contesto, in ordine alfabetico, ordini limite + stop 2×ATR): " +
        [...dv.withPlan].sort((x, y) => x.r.ticker.localeCompare(y.r.ticker)).map(p => {
          const atrTag = p.atr ? ` [stop = ingresso − 2×ATR ${p.atr.src}, ATR ${fmtNum.format(p.atr.pct)}%]` : " [stop fallback −8%: ATR n.d.]";
          // trimestrale <14gg su un CANDIDATO d'ingresso: il flag va NELLA riga del piano —
          // in tabella si perde e l'LLM rischia di suggerire un limite che scavalca l'evento (v112)
          const ed = earningsRiskDays(p.r);
          const earnTag = ed != null ? ` [!EARNINGS RISK: trimestrale ${p.r.earnings_date} tra ${ed}gg — valuta ingresso post-evento o sizing ridotto]` : "";
          // paracadute v115: se il supporto API era fuori banda, il limite viene da un
          // fallback e l'LLM deve saperlo (mai fallback silenziosi)
          const srcTag = p.limitFallback ? ` [supporto API fuori banda ±25%: limite da ${p.limitSrc}]` : "";
          // v119 — TUTTI i campi della citazione tracciabilità (prezzo, limite, stop, R/R) su
          // UNA riga: prima l'LLM doveva assemblarli cercando in tabella e sbagliava (metteva il
          // limite nello slot "Prezzo" della citazione). Ora cita direttamente da qui.
          const rr = p.r.risk_reward ? ` / R/R ${p.r.risk_reward}` : "";
          // target = resistenza (v148): è il numeratore del R/R — senza stamparlo l'LLM vedeva
          // il rapporto ma non il livello a cui punta il reward. Stessa banda di plausibilità.
          // v160 — il TARGET senza la sua DISTANZA dal prezzo è mezza informazione: HG mostrava
          // "target res. $36,28" con R/R 1:2.3 mentre il prezzo era già $36,16 (+0,3%). In tabella la
          // distanza c'era (v148), nella riga che genera gli ORDINI no — proprio dove serve. Un target
          // che coincide col prezzo rende il R/R aritmeticamente vero ed economicamente vuoto.
          const resT = (p.r.resistance != null && p.r.price > 0 && p.r.resistance > p.limit && p.r.resistance <= p.r.price * 2)
            ? (() => {
                const dFromPrice = (p.r.resistance / p.r.price - 1) * 100;
                const dFromLimit = (p.r.resistance / p.limit - 1) * 100;
                const warn = dFromPrice < 2
                  ? ` ⚠ il target è di fatto AL PREZZO ATTUALE: il R/R misura la distanza supporto→resistenza, non spazio di salita da qui`
                  : "";
                return ` / target res. $${fmtNum.format(p.r.resistance)} (${signTxt(Math.round(dFromPrice * 10) / 10)} dal prezzo, ${signTxt(Math.round(dFromLimit * 10) / 10)} dal limite)${warn}`;
              })()
            : "";
          // distanza del LIMITE dal prezzo = probabilità che l'ordine venga MAI eseguito. Un limite
          // a −6% su un nome al 100° percentile 52S non è "prudente": è un ordine che si riempie
          // solo se il trend si rompe. Il payload dava i due numeri separati e mai la loro distanza.
          const dLimit = (p.r.price > 0 && p.limit > 0) ? (p.limit / p.r.price - 1) * 100 : null;
          // v210 — il commento qui sopra descriveva il problema dal v160 ma NESSUNO LO CONTROLLAVA:
          // il payload stampava la distanza e basta. Trovato provando il prompt su me stesso —
          // MSFT a −16,5% e WDC a −22,5% passavano senza un flag, mentre il TARGET ha da sempre il
          // suo avviso ("⚠ il target è di fatto AL PREZZO ATTUALE"). Asimmetria: si avvisava quando
          // il premio era illusorio, non quando l'ingresso era irraggiungibile — e un ordine che non
          // si riempie mai, riportato come azione, dà la sensazione di aver agito senza aver agito.
          // La distanza si misura in ATR, non in percentuale secca: −16,5% su un titolo con ATR
          // 3,45% (4,8 ATR) e −22,5% su uno con ATR 9,92% (2,3 ATR) NON sono lo stesso ordine.
          const atrPc = atrOf(p.r)?.pct;
          const inAtr = (dLimit != null && atrPc > 0) ? Math.abs(dLimit) / atrPc : null;
          const limFar = inAtr != null && inAtr >= 3
            ? ` ⚠ sono ${fmtNum.format(Math.round(inAtr * 10) / 10)} ATR sotto il prezzo: questo ordine si riempie solo se il trend si rompe, non è "entrare in prudenza"`
            : "";
          const limT = dLimit != null
            ? ` (${signTxt(Math.round(dLimit * 10) / 10)} dal prezzo${inAtr != null ? ` = ${fmtNum.format(Math.round(inAtr * 10) / 10)}×ATR` : ""})${limFar}`
            : "";
          // se il prezzo esteso ha già mosso, dichiaralo QUI: la legenda dice "usa → agg. per gli
          // ordini limite" ma questo limite è calcolato sul supporto della chiusura → istruzioni in
          // conflitto se non si esplicita il rapporto fra i due.
          const pp = p.r.prepost || {};
          const aggP = dgFin(pp.price);
          const aggT = (aggP && p.r.price > 0 && Math.abs(aggP / p.r.price - 1) >= 0.01)
            ? ` [NB ${pp.label || "esteso"} $${fmtNum.format(aggP)} (${signTxt(Math.round((aggP / p.r.price - 1) * 1000) / 10)}): questo limite è calcolato sul supporto della CHIUSURA, non sul gap — se l'esteso tiene, il limite dista ${signTxt(Math.round((p.limit / aggP - 1) * 1000) / 10)} da lì]` : "";
          // v151 — candidato GIÀ DETENUTO col ratchet sopra il limite d'ingresso: raggiungere il
          // limite implica lo stop della posizione GIÀ scattato. Senza flag i due piani (accumulo
          // vs protezione) sembrano indipendenti e l'LLM deve dedurre il conflitto da solo.
          const heldStop = p.r.qty ? stopOf(p.r) : null;
          const heldTag = (heldStop && heldStop.stop > p.limit)
            ? ` [NB: posizione GIÀ detenuta con stop ratchet $${fmtNum.format(heldStop.stop)} SOPRA questo limite — il prezzo arriva al limite solo DOPO aver violato lo stop: decidi prima la sorte della posizione]` : "";
          // v158 — CAPIENZA RESIDUA AL CAP: il gate blocca chi è GIÀ oltre il cap, ma un candidato
          // appena sotto (MU 18,9% con cap 20%) lo ATTRAVERSA comprando, e il payload non dava
          // all'LLM alcun numero per accorgersene. Qui la capienza è CALCOLATA (quote entro il cap),
          // dichiarata come evidenza — non come divieto: sforare resta una scelta del CEO, ma esplicita.
          // v164 — DE-RATCHET: il ratchet si resetta quando cambia la quantità
          // (update_data.py: `stop = max(prev_stop, raw) if (prev_ok and same_pos) else raw`),
          // quindi ACCUMULARE fa cadere il trailing anche sulle quote GIÀ possedute, dal livello
          // ancorato a quello nuovo più basso. Il payload quantificava con precisione il rischio
          // del ri-arm sugli stop violati ma lasciava INVISIBILE questo costo simmetrico: un CIO
          // leggeva "COMPRA con stop $429" credendo il rischio limitato alle nuove quote.
          let deRatchetTag = "";
          if (p.r.qty > 0 && heldStop && heldStop.stop > p.stop && p.stop > 0) {
            const perShare = heldStop.stop - p.stop;
            const eurusdDR = DATA.eurusd || 1.08;
            const addEur = Math.round(p.r.qty * perShare / eurusdDR);
            if (addEur > 0) deRatchetTag = ` [⚠ DE-RATCHET: accumulare RESETTA il trailing da $${fmtNum.format(heldStop.stop)} a $${fmtNum.format(p.stop)} anche sulle ${fmtNum.format(p.r.qty)} quote GIÀ detenute → scopre ~${fmtEUR.format(addEur)} di downside sulla posizione esistente, oltre al rischio delle nuove quote.]`;
          }
          // v167 — CAP SULLA PERDITA POTENZIALE: il cap sul PESO non sa quanto costa un titolo se
          // va male, perché ignora la distanza dello stop. Qui la quantità massima discende dal
          // RISCHIO: quote × (limite − stop) ≤ maxLossPerPos_pct% del NAV. Su un nome volatile
          // (stop lontano) ne entrano poche, su uno tranquillo molte — a parità di rischio in €.
          const navTot = (DATA?.totals?.eur_invested || 0) + cashEur;
          let lossTag = "";
          if (p.limit > 0 && p.stop > 0 && p.limit > p.stop && navTot > 0) {
            const perShareUsd = p.limit - p.stop;
            const maxLossEur = RISK_PARAMS.maxLossPerPos_pct / 100 * navTot;
            const eurusdL = DATA.eurusd || 1.08;
            const qtyMax = Math.floor(maxLossEur * eurusdL / perShareUsd);
            const spesaEur = Math.round(qtyMax * p.limit / eurusdL);
            /* v247 — RESTA la perdita per quota allo stop: è una misura pura (distanza
               prezzo−stop in dollari). VIA il "col tetto del N% del NAV entrano max M quote",
               che era il tetto autorizzativo. */
            lossTag = ` [allo stop perdi $${fmtNum.format(Math.round(perShareUsd * 100) / 100)} a quota]`;
          }
          /* v247 — RIMOSSO il tag CAP (capienza residua / ESAURITA): è il divieto d'acquisto.
             Il PESO della posizione resta pubblicato altrove: quello è la misura. */
          const capTag = "";
          const wNow = p.r.qty ? positionWeightPct(p.r) : null;   // usato più sotto
          // v167 — QUALE VINCOLO MORDE. Con tre limiti attivi (budget spendibile, capienza al cap
          // sul peso, tetto di perdita allo stop) la quantità eseguibile è il MINIMO dei tre, e
          // farne l'intersezione a mente è esattamente il lavoro che il sistema deve togliere.
          /* v247 — RIMOSSO "VINCOLO PIÙ STRETTO": era l'intersezione di budget, cap e tetto
             di perdita, cioè la quantità massima autorizzata. Tolti budget e cap, non ha basi. */
          const bindTag = "";
          return `${p.r.ticker}: prezzo $${fmtNum.format(p.r.price)} → limite d'ingresso $${fmtNum.format(Math.round(p.limit * 100) / 100)}${limT} / stop $${fmtNum.format(p.stop)}${resT}${rr}${atrTag}${srcTag}${earnTag}${aggT}${heldTag}${deRatchetTag}${capTag}${lossTag}${bindTag}`;
        }).join(" · ") + ".");
    }
    if ((dv.trailing || []).length) {
      lines.push("· Stop trailing posizioni aperte (ratchet 2×ATR, ancorati — non ridiscendono): " +
        dv.trailing.map(x => {
          const prov = (x.atr?.src || "").includes("provvisorio");
          return `${x.r.ticker} stop $${fmtNum.format(x.stop)} (${signTxt(Math.round((x.stop / x.r.price - 1) * 1000) / 10)}${x.violated ? " ⚠VIOLATO" : ""}${prov ? " — PROVVISORIO −12%, ATR n.d. (storia <15 sedute): da inizializzare al prossimo run" : ""})`;
        }).join(" · ") + ".");
    }
    /* v247 — RIMOSSO: la lista degli ESCLUSI dal veto: tredici bocciature in fila, tre su posizioni DETENUTE. Sortino, short interest e ROIC restano come COLONNE. */
    /* v247 — RIMOSSO: i RIABILITATI: una riabilitazione è un verdetto rovesciato. */
    /* v247 — RIMOSSO: la prescrizione dello squeeze (sizing dimezzato, stop 1×ATR). Il FLAG descrittivo in tabella resta. */
    // v119 — il trim ora porta un PREZZO LIMITE di vendita e la QUANTITÀ esatta per rientrare
    // CAP D'INGRESSO (#1, direttiva CEO v121): i titoli ≥10% NAV NON ricevono nuovi acquisti,
    // ma NON vanno trimmati se cresciuti da soli (Let Winners Run, protetti dallo stop ratchet).
    /* v247 — RIMOSSO: il CAP D'INGRESSO: divieto d'acquisto. */
    // ALERT concentrazione singolo titolo: SOLO avviso sopra il 25%, mai un obbligo di trim.
    /* v247 — RIMOSSO: l'ALERT su singolo nome: soglia superata. La concentrazione MISURATA resta. */
    /* v247 — RIMOSSO: le posizioni «tese»: giudizio del motore. */
    /* v247 — RIMOSSO: le minusvalenze «utilizzabili fiscalmente»: è utilizzabile solo se REALIZZATA, quindi era una lista di vendite. Il P&L resta in Tabella A. */
  } catch { /* no-op */ }

  // ---- TRACK RECORD DEL MOTORE (v113): il motore si misura da solo, run dopo run.
  // I segnali ACCUMULA vengono loggati dal CI (scripts/log_verdict.mjs → verdict_track in
  // data.json) e valutati a 7/30 giorni: l'LLM deve CALIBRARE la fiducia nel motore sugli
  // esiti reali, non presumerla. Un advisory che non misura se stesso è solo narrativa.
  lines.push("");
  const vt = DATA.verdict_track;
  if (vt && ((vt.mature30 || {}).n || (vt.mature7 || {}).n)) {
    const fmtB = (b, lab) => b && b.n ? `${lab}: ${b.n} segnali · ritorno medio ${signTxt(b.avg_ret)} · vs NDX ${signTxt(b.avg_vs_ndx, "pp")} · hit-rate vs NDX ${b.hit_pct}%` : null;
    const bits = [fmtB(vt.mature30, "maturazione ≥30g"), fmtB(vt.mature7, "maturazione ≥7g")].filter(Boolean);
    lines.push(`TRACK RECORD DEL MOTORE (esito dei segnali ACCUMULA passati, ipotesi di acquisto alla chiusura del giorno del segnale — esiti misurati dei segnali passati): ${bits.join(" · ")}.`);
    if ((vt.last || []).length) lines.push("· Ultimi segnali maturati: " + vt.last.map(s => `${s.tk} ${signTxt(s.ret_pct)} (vs NDX ${signTxt(s.vs_ndx_pp, "pp")}, segnale ${s.date})`).join(" · ") + ".");
    // v159 — ONESTÀ STATISTICA: un "hit-rate 0% su 4 segnali" suona come una condanna del motore, ma
    // se i 4 segnali sono dello STESSO GIORNO su nomi correlati non sono 4 osservazioni indipendenti:
    // è UN evento di mercato osservato 4 volte, e non autorizza nessuna calibrazione. Senza questa
    // riga il payload induce un errore di inferenza (l'LLM conclude "il motore è rotto" da n=1).
    // v160 — TRACK RECORD DELLE DIVERGENZE: il sistema misura le PROPRIE affermazioni. Ogni divergenza
    // di cautela è una previsione implicita ("questo nome sottoperformerà"); il CI la scora da solo sui
    // prezzi, senza input manuale. Serve a sapere QUALI detector meritano fiducia e quali sono rumore.
    const dt = (vt.div_track || []).filter(x => x && x.n >= 3);
    if (dt.length) {
      const lab = { theme_rs: "flusso-non-conferma-narrativa", mcr_over_weight: "rischio≫peso",
                    verdict_vs_regime: "verdetto-vs-regime", relapse: "candidato-già-fallito",
                    accel_into_veto: "momentum-dentro-veto" };
      lines.push("· TRACK RECORD DELLE DIVERGENZE (il sistema misura le proprie segnalazioni: extra-rendimento medio vs NDX dopo ≥7g dalla segnalazione; per i segnali di CAUTELA \"azzeccato\" = il nome ha poi sottoperformato — un detector con hit-rate basso va pesato meno, non ripetuto): " +
        dt.map(x => `${lab[x.kind] || x.kind} — ${x.n} casi, media ${signTxt(x.avg_rel_pp, "pp")}${x.hit_pct != null ? `, azzeccati ${x.hit_pct}%` : " (segnale dichiarato ambiguo: si misura la direzione, non la ragione)"}`).join(" · ") + ".");
    } else if ((vt.div_open || 0) > 0) {
      lines.push(`· TRACK RECORD DELLE DIVERGENZE: in costruzione — le ${vt.div_open} divergenze di oggi vengono loggate e valutate sui prezzi fra 7 e 30 giorni, automaticamente. Finché non matura, trattale come ipotesi argomentate, non come detector provati.`);
    }
    const days = [...new Set((vt.last || []).map(s => s.date).filter(Boolean))];
    const nSig = ((vt.mature7 || {}).n || 0) + ((vt.mature30 || {}).n || 0);
    if (days.length === 1 && (vt.last || []).length > 1) {
      lines.push(`· ⚠ LIMITE STATISTICO DEL CAMPIONE: tutti i segnali maturati provengono da UN SOLO giorno (${days[0]}) e da nomi fortemente correlati — è un evento osservato più volte, NON osservazioni indipendenti. Un hit-rate calcolato così NON è una misura della bontà del motore: in quella finestra il motore ha comprato debolezza che è poi peggiorata, ma su un solo evento. Il campione diventa informativo con segnali distribuiti su più date.`);
    } else if (nSig > 0 && nSig < 10) {
      lines.push(`· ⚠ CAMPIONE PICCOLO (${nSig} segnali su ${days.length} date distinte): indizio direzionale, non evidenza statistica — non trarne conclusioni forti sulla bontà del motore.`);
    }
  } else {
    lines.push("TRACK RECORD DEL MOTORE: storico in costruzione — i segnali ACCUMULA vengono loggati a ogni run e valutati dopo 7 e 30 giorni di maturazione. Finché non matura, tratta i candidati del motore come ipotesi da validare, non come raccomandazioni provate.");
  }

  // ---- CINEMATICA DEI SEGNALI: RIMOSSA dal payload (v184, come TOP 10 CAPITALIZZAZIONI in v138).
  // Misurato prima di togliere: 21 numeri su 21 comparivano GIÀ altrove nel payload — Sharpe e il
  // suo Δ7g in SITUAZIONE PATRIMONIALE e nel digest storico, VIX e VIX/VIX3M in QUADRO MACRO,
  // ΔRS e ΔMCR sono COLONNE della tabella CINEMATICA & TREND PER TITOLO. Zero informazione persa,
  // un allineamento in meno da mantenere (è la classe di difetto che ha prodotto C11).
  // Il calcolo per-titolo resta vivo: lo fa titleKinematics(), usata dalla tabella e dalla UI.
  // DIARIO DELLE AZIONI (storico operazioni e motivazioni dell'utente)
  const diary = loadDiary();
  if (diary.length) {
    lines.push("");
    lines.push("DIARIO DELLE AZIONI (operazioni eseguite dal CEO, col prezzo reale annotato):");
    diary.slice(0, 30).forEach(e => lines.push(`- ${new Date(e.date).toLocaleDateString("it-IT")}: ${e.text}`));
    lines.push("(NB sulle fonti: il diario è testo libero scritto dal CEO, la Tabella A è generata dai dati del broker. Se le due non concordano su quantità o PMC, la Tabella A è la fonte autoritativa.)");
  } else {
    // l'analisi per-titolo cita il diario: se è vuoto va DETTO (anti-allucinazione),
    // non lasciato all'LLM da indovinare cercando una sezione che non c'è
    lines.push("");
    lines.push("DIARIO DELLE AZIONI: vuoto — nessuna operazione registrata di recente.");
  }
  lines.push("");
  lines.push(`PORTAFOGLIO — ${DATA.portfolio.length} POSIZIONI (Tabella A — i tuoi dati per posizione: controvalore e P&L reali; Sharpe 1A = rendimento/rischio; Drawdown 52S = distanza dal max; ±ImpMove = movimento implicito earnings; RVol = volume oggi/media 30gg; Stop 2×ATR = stop dinamico su volatilità. È la tua materia prima: cita la cella dove regge una decisione, NON riprodurre la tabella):`);
  const f = (v, d = 2) => v === null || v === undefined ? "—" : fmtNum.format(v);
  const mdRow = (r) => {
    const c = cur(r);
    const optC = (DATA.options || {})[r.ticker];
    // wall sanity: un muro fuori da 0.4×–2.5× lo spot è un relitto di chain degenere → n.d.
    const wallOk = (w) => (w != null && r.price != null && w >= r.price * 0.4 && w <= r.price * 2.5) ? w : null;
    let cw = wallOk(optC?.expiries?.[0]?.call_wall), pw = wallOk(optC?.expiries?.[0]?.put_wall);
    if (cw != null && cw === pw && r.price && Math.abs(cw / r.price - 1) > 0.25) { cw = pw = null; }   // firma chain artefatta
    const optNote = (cw != null || pw != null) ? `CW:${cw != null ? c + f(cw) : "n.d."} PW:${pw != null ? c + f(pw) : "n.d."}` : "—";
    const rsBench = r.rs_bench === "sox" ? "SOX" : r.rs_bench === "ndx" ? "NDX" : "S&P";
    const rsCell = r.rs_1m != null ? `${r.rs_1m > 0 ? "+" : ""}${r.rs_1m}% (vs ${rsBench})` : "—";
    const rsNdxCell = r.rs_ndx_1m != null ? `${r.rs_ndx_1m > 0 ? "+" : ""}${r.rs_ndx_1m}pp` : "—";
    const sh = r.sharpe_1y != null ? fmtNum.format(r.sharpe_1y) : "—";
    const so = r.sortino_1y != null ? fmtNum.format(r.sortino_1y) : "—";
    const dd = r.w52_dist_pct != null ? signTxt(r.w52_dist_pct) : "—";
    const im = impliedMoveForEarnings ? impliedMoveForEarnings(r) : null;
    const imTxt = im != null ? `±${im}%` : "—";
    const shortF = r.stats?.short_float != null ? fmtNum.format(Math.round(r.stats.short_float * 1000) / 10) + "%" : "—";
    // Flottante (azioni liberamente scambiabili): milioni/miliardi + % sul totale se disponibile.
    // Rischio short squeeze / volatilità asimmetrica: low float + short alto + RVol alto = polveriera.
    const fsh = r.stats?.float_shares;
    const floatCell = fsh != null
      ? (fsh >= 1e9 ? (fsh / 1e9).toFixed(1) + "B" : Math.round(fsh / 1e6) + "M") + (r.stats?.float_pct != null ? ` (${fmtNum.format(r.stats.float_pct)}%)` : "")
      : "—";
    // RVol (Volume Relativo) + flag Volumi Anomali (>1,5×)
    const rv = r.vol_ratio;
    const rvCell = rv != null ? `${fmtNum.format(rv)}×${rv > 1.5 ? " [Volumi Anomali]" : ""}` : "—";
    // Stop trailing: ratchet della pipeline sulle posizioni, 2×ATR client su watchlist.
    // Gli INDICI (currency PTS: KOSPI, ^IXIC…) non sono comprabili: stop e R/R sarebbero
    // rumore che invita l'LLM a "operare" su un benchmark → n.d. esplicito (v112).
    // v118 — COERENZA DI RIGA: sui candidati watchlist lo stop teorico si ancora al SUPPORTO
    // MOSTRATO nella riga stessa (colonna Supp.), non al prezzo corrente. Prima, su ATR alto
    // (SNDK: 2×ATR=$406, prezzo $1916, supporto $1485) lo stop-da-prezzo usciva $1509 → SOPRA
    // il supporto → stop-loss long impossibile. Ancorando a r.support, stop = supp − 2×ATR è
    // SEMPRE sotto il supporto per costruzione (ATR>0): la riga è coerente con sé stessa
    // (invariante I6 del red team). Fallback a saneEntryLimit/prezzo se il supporto manca.
    const isIndex = r.currency === "PTS";
    const entryRef = (!isIndex && !r.qty)
      ? ((r.support > 0 && r.support <= r.price) ? r.support : (saneEntryLimit(r)?.limit ?? r.price))
      : r.price;
    const st = isIndex ? null : (r.qty ? stopOf(r) : atrStop(entryRef, r));
    let stopCell = "—";
    if (st) {
      // "provvisorio" ha priorità sul tag generico: uno stop −12% senza ATR (SKHYV young)
      // NON è un ratchet ancorato, e l'LLM lo deve sapere (v119)
      const tag = (st.src || "").includes("provvisorio") ? "provvisorio" : (r.qty ? (st.ratchet ? "ratchet" : "client") : "teorico");
      stopCell = `${c}${f(st.stop)} (${tag})`;
    }
    // flag di rischio inline nel nome: stop violato, earnings imminenti, illiquidità, FX
    const flags = [];
    const dr = (DATA.macro || {}).dollar_ruler;
    if (dr && dr.flag && (r.stats?.market_cap ?? 0) >= 100e9) {
      flags.push(dr.chg_3m_pct >= 5 ? "[FX HEADWIND]" : "[FX TAILWIND]");   // large cap: utili esteri sensibili al dollaro
    }
    if (r.qty && st && st.violated) flags.push("[STOP VIOLATO]");
    // ORARIO ESTESO v125 (Risultato 2): un movimento pre/after >1% che porta il prezzo esteso
    // a ridosso o sotto lo stop ratchet è un pericolo che matura mentre Wall Street è chiusa.
    /* ⚠ v230 — IL NUMERO NEL TAG NON ERA QUELLO CHE SEMBRAVA. Stampava il GAP pre/chiusura, e
       un report reale l'ha letto come lo sfondamento dello stop ("stop violato -4,32% in
       pre-market": -4,32% era il gap, non la distanza dallo stop). Peggio: su PLTR il tag diceva
       "STOP A RISCHIO … +2,63%" mentre quel movimento portava il prezzo SOPRA lo stop, cioe'
       fuori dalla violazione — l'etichetta affermava il contrario di cio' che il numero mostrava.
       Ora il tag dichiara la DISTANZA DALLO STOP, che e' la grandezza di cui parla, e cambia
       parola quando il prezzo esteso e' sopra. */
    if (r.qty && st && r.prepost && Math.abs(r.prepost.change_pct ?? 0) > 1 && r.prepost.price <= st.stop * 1.02) {
      const dSt = (r.prepost.price / st.stop - 1) * 100;
      const et = (r.prepost.label || "ext").toUpperCase();
      flags.push(dSt < 0
        ? `[${et} $${fmtNum.format(r.prepost.price)} SOTTO LO STOP $${fmtNum.format(st.stop)}: ${signTxt(Math.round(dSt * 10) / 10)}]`
        : `[${et} $${fmtNum.format(r.prepost.price)} A RIDOSSO DELLO STOP $${fmtNum.format(st.stop)}: ${signTxt(Math.round(dSt * 10) / 10)}, sopra ma vicino]`);
    }
    if (earningsRiskDays(r) != null) flags.push("[!EARNINGS RISK]");
    if (isIlliquid(r)) flags.push("[ILLIQUIDO]");
    if (squeezeSetup(r)) flags.push("[TURNAROUND SQUEEZE RISK]");
    const nameCell = `${r.name} (${r.ticker})${flags.length ? " " + flags.join(" ") : ""}`;
    // R/R teorico per la Tabella B: pipeline (risk_reward) o fallback client stessa formula.
    // Banda di plausibilità v115: un supporto sotto il 50% del prezzo è preistoria/garbage
    // → il R/R che ne uscirebbe è spazzatura con la virgola: meglio n.d.
    let rrCell = isIndex ? null : (r.risk_reward ?? null);
    if (rrCell == null && !isIndex && r.support && r.resistance && r.support > 0 && r.price > 0
        && r.support >= r.price * 0.5 && r.resistance <= r.price * 2) {   // resistenza >2× il prezzo = garbage (v116)
      const aObj = atrOf(r);
      if (aObj && aObj.atr > 0) {
        const reward = r.resistance - r.support, risk = 2 * aObj.atr;
        rrCell = (reward > 0 && risk > 0) ? `1:${(reward / risk).toFixed(1)}` : null;
      }
    }
    rrCell = rrCell ?? (isIndex ? "—" : "n.d.");
    const adjL = r.prezzo_limite_aggiustato;
    // STALENESS dichiarata (v112): se l'ultima chiusura valida è più vecchia della data del
    // run (barra odierna voidata da Yahoo — visto sul KOSPI leading), il prompt lo dice:
    // senza flag l'LLM legge il movimento del giorno PRIMA come se fosse quello corrente.
    // v125: [LIVE] per gli strumenti che scambiano fuori orario USA (KOSPI/BTC/futures): il
    // prezzo è l'ultimo scambio real-time, non la candela stantia. Ha priorità sullo staleTag.
    // v182: [LIVE] solo se il mercato di quello strumento è DAVVERO in contrattazione. Cripto e
    // futures scambiano h24; gli indici asiatici no, e fuori orario "live" e' l'ultimo scambio.
    const liveVero = r.price_live && (/-USD$|=F$/.test(r.ticker || "") || r.ticker !== "^KS11" || seoulSessionOpen());
    const staleTag = liveVero ? " [LIVE]"
      : (r.price_asof && DATA.updated_at && r.price_asof < DATA.updated_at.slice(0, 10)
        ? ` [chiusura del ${new Date(r.price_asof + "T00:00:00").toLocaleDateString("it-IT").slice(0, 5)}]` : "");
    const priceCell = `${c}${f(r.price)}${staleTag}${(adjL != null && r.price != null && Math.abs(adjL - r.price) / r.price > 0.001) ? ` → agg. ${c}${f(adjL)} (${r.prepost?.label || "ext"})` : ""}`;
    // Supp. + resistenza NELLA STESSA CELLA (v148): la resistenza era calcolata (è il "reward"
    // del R/R teorico) ma MAI stampata — l'LLM vedeva il rapporto senza il livello target.
    // In-cell (non nuova colonna) per non spostare gli indici I6 del red team (16=Supp., 17=Stop)
    // e perché euro()/parseIt leggono il PRIMO numero → i validatori continuano a leggere il
    // supporto. Stessa banda di plausibilità del R/R (res ≤ 2× prezzo, res > supp).
    const resOk = r.resistance != null && r.support > 0 && r.resistance > r.support
      && r.price > 0 && r.resistance <= r.price * 2;
    // v150: distanza % della res dal prezzo IN CELLA — una res lontana (es. +51% su un nome
    // crollato) gonfia otticamente il R/R teorico: col numero accanto l'LLM pesa l'orizzonte.
    const suppCell = r.support ? `${c}${f(r.support)}${resOk ? ` → res ${c}${f(r.resistance)} (${signTxt(Math.round((r.resistance / r.price - 1) * 1000) / 10)})` : ""}` : "—";
    // Sortino 6M accanto all'1A (v148): la "finestra di regime" era calcolata per tutti ma
    // mostrata solo per i riabilitati. È il dato ODIERNO che la SIMMETRIA DEL VETO richiede:
    // 1A negativo + 6M in recupero = veto ciclico; entrambi negativi = strutturale.
    const so6 = r.sortino_6m != null ? ` (6M ${fmtNum.format(r.sortino_6m)})` : "";
    return `| ${nameCell} | ${r.qty ? fmtNum.format(r.qty) : "—"} | ${r.qty ? c + f(r.pmc) : "—"} | ${priceCell} | ${signTxt(r.change_pct)} | ${r.qty ? signTxt(r.gain_pct) : "—"} | ${r.rsi ?? "—"} | ${rvCell} | ${rsCell} | ${rsNdxCell} | ${sh} | ${so}${so6} | ${dd} | ${shortF} | ${floatCell} | ${suppCell} | ${stopCell} | ${rrCell} | ${r.pe && r.pe > 0 ? f(r.pe) : "—"} | ${f(r.eps)} | ${f(betaOf(r))} | ${r.rating?.upside_pct != null ? signTxt(r.rating.upside_pct) : "—"} | ${r.earnings_date || "—"}${im != null ? ` ${imTxt}` : ""} | ${optNote} |`;   /* v252 — via anche qui la colonna Segnale: in v251 l'avevo tolta solo dalla DASHBOARD, e il payload continuava a portarla. Classe "due implementazioni della stessa cosa" (v161, v207). */
  };
  // NB v148: "Supp." resta il NOME esatto della colonna (il red team I10 la cerca per nome; I6
  // legge gli indici 16/17) — la resistenza vive DENTRO la cella ("$X → res $Y"), il Sortino 6M
  // dentro la cella Sortino ("-0,4 (6M 0,2)"): niente colonne nuove, niente indici spostati.
  const head = "| Titolo | Qtà | PMC | Prezzo | Oggi | Guad.% | RSI | RVol | RS 1M (vs bench) | RS 1M vs NDX | Sharpe 1A | Sortino 1A (6M) | Drawdown 52S | Short% | Float | Supp. | Stop 2×ATR | R/R teorico | P/E | EPS | Beta NDX | Target Δ | Trimestrale (±ImpMove) | Opzioni (CW/PW) |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  lines.push(head); lines.push(sep);
  DATA.portfolio.forEach(r => lines.push(mdRow(r)));
  lines.push("(Stop = TRAILING RATCHET: parte a 2×ATR(14 Wilder) sotto il prezzo e da lì può solo SALIRE coi massimi — non si riabbassa nei ribassi; persistito tra i run, si resetta se il trade cambia. \"client\"=ricalcolato ora senza ancoraggio, \"teorico\"=watchlist. [STOP VIOLATO] = prezzo sotto lo stop ancorato → disciplina: uscita o ri-arm dichiarato. Sortino 1A = Sharpe con la sola volatilità NEGATIVA: è il metro del veto value trap (< ${fmtNum.format(RISK_PARAMS.sortinoVeto)} = distruzione di valore sul downside — soglia LETTA dai parametri attivi, non scritta a mano); il \"(6M …)\" accanto è la FINESTRA DI REGIME: 1A negativo con 6M in recupero = danno ciclico in via di riassorbimento (evidenza ODIERNA per la simmetria del veto), entrambi negativi = strutturale. Supp. = supporto; \"→ res $Y (+Z%)\" nella stessa cella = RESISTENZA col suo distacco dal prezzo (il target del R/R teorico: reward = res − supp) — sono i due estremi su cui è calcolato il R/R teorico; quando la resistenza è molto distante (+30% e oltre) il rapporto risulta alto per via dell'orizzonte implicito, non della qualità del setup. Beta NDX = regressione log-rendimenti 12M vs Nasdaq 100 (non il beta 5A Yahoo). [Volumi Anomali] = RVol>1,5. [!EARNINGS RISK] = trimestrale <14gg. [ILLIQUIDO] = posizione >5% del volume medio giornaliero → slippage rilevante. Float = azioni fluttuanti liberamente scambiabili (milioni/miliardi, e % sul totale). R/R teorico = già calcolato dal sistema (reward = resistenza − supporto; risk = 2×ATR); n.d. = non calcolabile. \"→ agg. $X\" = prezzo limite già aggiustato dal sistema sul gap pre/after (la chiusura da sola non lo incorpora). [FX HEADWIND/TAILWIND] = large cap (mcap≥$100B) esposta al Righello Dollaro attivo.)");
  lines.push("· [LOW FLOAT RISK]: Un titolo con flottante ridotto (Low Float < 50M azioni) unito a uno Short Interest ≥ 15% e Volumi Anomali (RVol > 1.5) indica un rischio imminente di Short Squeeze o volatilità asimmetrica estrema. L'AI deve evidenziarlo come un'opportunità o un pericolo immediato di liquidità.");
  // MATRICE DI RISCHIO PER POSIZIONE: pesi MTM, MCR, beta NDX, correlazioni reali
  const riskRows = (DATA.portfolio || []).filter(r => r.qty && (r.risk_contrib_pct != null || r.avg_corr != null || r.beta_ndx != null));
  if (riskRows.length) {
    lines.push("");
    lines.push("MATRICE DI RISCHIO PER POSIZIONE (log-rendimenti giornalieri 12M, pesi mark-to-market — usa QUESTI numeri per correlazione e concentrazione del rischio, non stime a memoria):");
    lines.push("| Titolo | Quota rischio ptf (MCR) | Corr. media vs ptf | Corr. max (con) |");
    lines.push("|---|---|---|---|");
    riskRows.slice().sort((a, b) => (b.risk_contrib_pct ?? -1) - (a.risk_contrib_pct ?? -1)).forEach(r => {
      // v184: "Peso % NAV" e "Beta NDX" tolti — il peso e' gia' accanto a ogni titolo nelle
      // CORRELAZIONI ("MU (18,9% NAV · MCR 39,8% · RS -2,8pp)") e il beta e' una colonna della
      // Tabella A. Restano MCR (unica classifica completa del rischio, ordinata, somma 100%) e
      // le due correlazioni, che non esistono da nessun'altra parte del payload.
      lines.push(`| ${r.ticker} | ${r.risk_contrib_pct != null ? fmtNum.format(r.risk_contrib_pct) + "%" : "—"} | ${r.avg_corr != null ? fmtNum.format(r.avg_corr) : "—"} | ${r.max_corr != null ? `${fmtNum.format(r.max_corr)} (${r.max_corr_with})` : "—"} |`);
    });
    lines.push("(MCR = contributo marginale al rischio: quota % della varianza totale del portafoglio attribuibile alla posizione — la somma fa 100%. Una posizione con MCR molto sopra il suo peso concentra il rischio. I titoli con storia <60 sedute — IPO e nuove quotazioni — sono esclusi da beta/correlazioni/MCR BY DESIGN, soglia statistica minima: non è un buco dati.)");
  }
  if ((DATA.watchlist || []).length) {
    lines.push("");
    lines.push(`WATCHLIST — ${DATA.watchlist.length} TITOLI (Tabella B — nessuna posizione, è il tuo universo di caccia: cita un nome solo se entra in una tesi operativa, NON riprodurre la tabella):`);
    // v184 — colonne tolte alla sola Tabella B (la dashboard NON cambia): 2 Qta, 3 PMC,
    // 6 Guad.% (sempre vuote senza posizione) e 19 P/E, 20 EPS (gia' in ANALISI FONDAMENTALE
    // per tutti i titoli della watchlist). Gli indici sono quelli della `head` condivisa e la
    // proiezione avviene DOPO mdRow, cosi' la Tabella A e il red team (che legge gli indici
    // 16/17 e il nome "Supp.") restano invariati.
    // v185: EPS (20) RIMESSO. Provando il payload su me stesso e' emerso il caso Bloom Energy:
    // nel fondamentale BE mostra "P/E —" con ROE +1,3% e margine +0,3%, tutto in apparenza sano,
    // e senza EPS non c'e' modo di sapere che l'utile per azione e' NEGATIVO (-0,04). Per gli
    // altri cinque titoli senza P/E il segno lo davano ROE o margine, per BE no. La convenzione
    // della tabella e' "P/E = '—' quando EPS<0 per igiene matematica": togliere EPS rendeva quel
    // trattino ambiguo fra "dato mancante" e "societa' in perdita". P/E resta tolto: quello e'
    // davvero duplicato in ANALISI FONDAMENTALE per tutti e 25 i titoli.
    const TAGLIA_WL = new Set([2, 3, 6, 19]);
    const proietta = (riga) => {
      const c = riga.split("|");
      return c.filter((_, i) => !TAGLIA_WL.has(i)).join("|");
    };
    lines.push(proietta(head)); lines.push(proietta(sep));
    DATA.watchlist.forEach(r => lines.push(proietta(mdRow(r))));
    // correlazione dei candidati watchlist vs il portafoglio ESISTENTE (per la regola n.2)
    const wlCorr = (DATA.watchlist || []).filter(r => r.avg_corr != null || r.max_corr != null);
    if (wlCorr.length) {
      lines.push("· Correlazione dei candidati watchlist vs il portafoglio attuale (per la regola CORRELAZIONE E SOVRAESPOSIZIONE): " +
        wlCorr.map(r => `${r.ticker} media ${fmtNum.format(r.avg_corr)}${r.max_corr != null ? `, max ${fmtNum.format(r.max_corr)} con ${r.max_corr_with}` : ""}`).join(" · ") + ".");
    }
  }
  lines.push("");
  // ANALISI FONDAMENTALE DETTAGLIATA per ticker
  // Universo = STESSO predicato del FONDAMENTALE PROFONDO (isEquity): le due tabelle fondamentali
  // devono coprire gli STESSI titoli. Prima il filtro era `r.stats?.market_cap`: quando l'API
  // azzerava il market_cap di un nome che aveva comunque P/E/ROE/PEG (capitava su AMD/MU/CRM),
  // la riga spariva SOLO da qui — senza conteggio-guardia che se ne accorgesse — mentre restava
  // nel PROFONDO. Ora l'inclusione non dipende dal market_cap (serve solo al P/FCF, che diventa
  // "—" se manca) e il conteggio "N TITOLI → N righe" fa scattare l'invariante I4 su ogni drop.
  const fundItems = [...(DATA.portfolio || []), ...(DATA.watchlist || [])].filter(isEquity);
  if (fundItems.length) {
    lines.push(`ANALISI FONDAMENTALE DETTAGLIATA — ${fundItems.length} TITOLI → ${fundItems.length} righe (valutazione e qualità per le tue raccomandazioni; deve coprire gli stessi titoli del FONDAMENTALE PROFONDO):`);
    // v193 — P/E FORWARD ACCANTO AL TRAILING. Il CEO ha chiesto se i P/E fossero "sballati":
    // AMD 175×, PLTR 138×, CBRS 433×. I conti tornano (prezzo/EPS combacia), ma il payload
    // pubblicava SOLO il trailing, che usa l'utile GAAP degli ultimi 12 mesi — depresso da
    // ammortamenti e straordinari. Il forward degli stessi titoli e' 38×, 59× e 208×. Il campo
    // stats.forward_pe era gia' in data.json e non compariva da nessuna parte: un dato non
    // sbagliato ma INCOMPLETO, che faceva sembrare rifiutabile per prezzo un titolo che il
    // mercato prezza su utili attesi molto piu' alti.
    lines.push("| Titolo | P/E TTM | P/E fwd | P/FCF | EV/EBITDA | ROE | Marg.netto | Cresc.ricavi | P/B | PEG | Altman Z'' | Div% | Buyback% | Note |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    fundItems.forEach(r => {
      const st = r.stats || {};
      const pfcf = st.market_cap && st.fcf && st.fcf > 0 ? Math.round(st.market_cap / st.fcf * 10) / 10 : null;
      const peTtm2 = st.pe_ttm || r.pe;
      const fcfWarn = pfcf != null && peTtm2 > 0 && pfcf > peTtm2 * 2 ? " [!FCF]" : "";
      const roeTag = st.roe != null && st.roe > 0.15 ? " [ROE>15%]" : "";
      const wlTag = DATA.portfolio.find(p => p.ticker === r.ticker) ? "" : " [WL]";
      // Altman Z-Score + flag [RISCHIO DEFAULT] se <1,81
      // quando il trailing e' molto sopra il forward, l'utile GAAP corrente NON e' la base su
      // cui il mercato sta prezzando: dirlo evita di leggere un P/E alto come "caro".
      const peFwd = st.forward_pe > 0 ? st.forward_pe : null;
      const gapTag = (peFwd && peTtm2 > 0 && peTtm2 / peFwd >= 2) ? " [GAAP DEPRESSO]" : "";
      const zTag = st.altman_z != null && st.altman_z < 1.81 ? " [RISCHIO DEFAULT]" : "";
      const zCell = st.altman_z != null ? fmtNum.format(st.altman_z) + zTag + (st.altman_missing ? " (proxy)" : "") : "n.d.";
      // [BILANCI VALUTA LOCALE]: la pipeline ha nullato P/B, EV/EBITDA e P/FCF perché i bilanci
      // sono in valuta diversa dal prezzo (ADR tipo TSM) — senza il tag i "—" sembrano buchi dati
      const fxTag = st.cross_currency ? " [BILANCI VALUTA LOCALE]" : "";
      const noteTags = [roeTag.trim(), fcfWarn.trim(), zTag.trim(), fxTag.trim(), gapTag.trim()].filter(Boolean).join(" ");
      lines.push(`| ${r.ticker}${wlTag} | ${peTtm2 > 0 ? fmtNum.format(Math.round(peTtm2 * 10) / 10) + "×" + gapTag : "—"} | ${peFwd ? fmtNum.format(Math.round(peFwd * 10) / 10) + "×" : "—"} | ${pfcf ? fmtNum.format(pfcf) + "×" + fcfWarn : "—"} | ${st.ev_ebitda ? fmtNum.format(Math.round(st.ev_ebitda * 10) / 10) + "×" : "—"} | ${st.roe ? pctOf(st.roe) + roeTag : "—"} | ${st.profit_margin ? pctPlain(st.profit_margin) : "—"} | ${st.revenue_growth ? pctOf(st.revenue_growth) : "—"} | ${st.price_to_book ? fmtNum.format(Math.round(st.price_to_book * 10) / 10) + "×" : "—"} | ${st.peg > 0 ? fmtNum.format(Math.round(st.peg * 100) / 100) : "n.d."} | ${zCell} | ${st.dividend_yield ? pctPlain(st.dividend_yield) : "—"} | ${st.buyback_yield != null ? signTxt(Math.round(st.buyback_yield * 1000) / 10) + (st.buyback_yield < -0.005 ? " [DILUISCE]" : "") : "—"} | ${noteTags} |`);
    });
    lines.push("([GAAP DEPRESSO]=il P/E trailing è almeno il DOPPIO del forward: l'utile GAAP degli ultimi 12 mesi è compresso da ammortamenti/straordinari e NON è la base su cui il mercato prezza — leggere il P/E fwd accanto; [ROE>15%]=Return on EQUITY oltre il 15% — NB: è ROE, non ROIC: su società con molta leva o buyback aggressivi il denominatore (patrimonio netto) si comprime e il valore si gonfia, quindi NON coincide con la qualità del capitale investito; [!FCF]=P/FCF >> P/E → controllare accrual/earnings quality; [RISCHIO DEFAULT]=Altman Z''<1,81, flag prudenziale del mandato — Z'' è la variante non-manifatturieri (6.56·WC/TA+3.26·RE/TA+6.72·EBIT/TA+1.05·MVE/TL, senza Sales/TA), cutoff canonici <1,1 distress / >2,6 solido; P/E TTM='—' con EPS<0 per igiene matematica; [BILANCI VALUTA LOCALE]=ADR con bilanci in valuta diversa dal prezzo: P/B, EV/EBITDA e P/FCF nullati a monte perché a unità miste — i '—' su quelle colonne NON sono buchi dati; [WL]=watchlist; Buyback%=riacquisti NETTI delle emissioni / market cap dall'ultimo cashflow annuale — discriminante growth: >0 restituisce capitale riducendo le azioni, [DILUISCE]=emissioni>riacquisti, tipico SBC pesante che erode l'EPS per azione)");
    if (DATA.sanity_filtered > 0) lines.push(`[!ANOMALIE FILTRATE DAL SANITY CHECK: ${DATA.sanity_filtered} — valori palesemente errati delle API (P/E assurdi, variazioni impossibili) sono stati rimossi a monte: i dati qui presenti sono già puliti]`);
    lines.push("");
  }
  // contesto economia USA (stile Macrotrends): P/E mercato, tassi Fed, inflazione, PIL, curva
  const usEco = [];
  if (m.sp500_pe) usEco.push(`P/E S&P 500 ${m.sp500_pe.current}×${m.sp500_pe.avg_10y != null ? ` (media 10A ${m.sp500_pe.avg_10y}×)` : ""}${m.sp500_pe.nasdaq_pe ? `, P/E Nasdaq 100 ${m.sp500_pe.nasdaq_pe}×` : ""}`);
  if (m.fed_market) usEco.push(`tasso Fed ${m.fed_market.current_rate}%`);
  const cpiI = (m.indicators || []).find(i => i.key === "cpi");
  const pceI = (m.indicators || []).find(i => i.key === "pce");
  if (cpiI) usEco.push(`inflazione CPI ${cpiI.value}`);
  if (pceI) usEco.push(`PCE ${pceI.value}`);
  if (m.yield_recession?.gdp_last != null) usEco.push(`PIL reale YoY ${signTxt(m.yield_recession.gdp_last)}`);
  if (m.yield_recession?.current_curve != null) usEco.push(`curva 10A-2A ${signTxt(m.yield_recession.current_curve)} pp`);
  // CONTESTO ECONOMIA USA: RIMOSSO dal payload (v184). Verificato numero per numero: P/E S&P e
  // Nasdaq stanno in ROTAZIONE SETTORIALE, tasso Fed / CPI / PCE / curva 10A-2A in QUADRO MACRO,
  // e il PIL reale YoY compariva DUE VOLTE con formati diversi ("+2,68%" qui, "2.68%" nella riga
  // Curva vs Recessione) — cioè lo stesso dato che si presentava come due dati.
  void usEco;
  // DATA QUALITY REPORT: i dati flaggati dalle assertions vengono dichiarati PRIMA del quadro
  // macro, con l'ordine esplicito di fare double-check web su ciò che è datato/inaffidabile
  if (!dqV.ok) {
    lines.push(`⚠ DATA QUALITY REPORT (assertions automatiche del sistema): ${[...dqV.bad.map(b => `${b.key} INAFFIDABILE (${b.status}${b.note ? ": " + b.note : ""})`), ...dqV.stale.map(s => `${s.key} DATATO oltre la cadenza attesa`)].join(" · ")}. Per ogni dato marcato qui sotto con [!!! DATATO / UNRELIABLE !!!] o [LAG TEMPORALE RILEVATO]: NON usarlo così com'è — fai double-check con la ricerca web e cita il valore aggiornato con fonte e data.`);
    const missingKeys = dqV.bad.map(b => b.key);
    if (missingKeys.length) {
      lines.push(`ATTENZIONE — ORDINE OPERATIVO: i seguenti dati sono mancanti o inaffidabili nel payload: [${missingKeys.join(", ")}]. PRIMA di generare la tua analisi, usa OBBLIGATORIAMENTE il tuo strumento di ricerca web per reperire questi valori in tempo reale (cita valore, fonte e data per ciascuno) e usali al posto di quelli assenti — in particolare per valutare leva finanziaria e valutazioni di mercato.`);
    }
  }
  if ((dqV.overrides || []).length) {
    lines.push(`OVERRIDE MANUALI ATTIVI (valori inseriti dall'utente perché la fonte era ko — trattali come dati validi ma verifica se puoi): ${dqV.overrides.map(o => `${o.key} [MANUAL_OVERRIDE del ${o.date || "n.d."}]`).join(" · ")}.`);
  }
  lines.push("QUADRO MACRO:");
  if (m.risk_sentiment) lines.push(`- Sentiment globale: ${m.risk_sentiment.label} (${m.risk_sentiment.score}/100)`);
  if (m.thermometer) lines.push(`- Termometro tecnico del portafoglio: ${m.thermometer.label} (${m.thermometer.score}/100)`);
  if (m.fear_greed) {
    let fgl = `- Fear & Greed: ${m.fear_greed.score} (${FG_LABELS[m.fear_greed.rating] || m.fear_greed.rating}), 1 settimana fa ${m.fear_greed.week_ago}, 1 mese fa ${m.fear_greed.month_ago}${m.fear_greed.year_ago ? `, 1 anno fa ${m.fear_greed.year_ago}` : ""}`;
    if ((m.fear_greed.components || []).length) fgl += ` [componenti: ${m.fear_greed.components.map(c => `${c.label} ${c.rating}${c.score != null ? ` ${c.score}` : ""}`).join("; ")}]`;
    lines.push(fgl);
  }
  // sanity finale sul payload: un valore impossibile diventa "n.d." e NON entra nell'analisi
  const nd = (v, lo, hi) => (v != null && v >= lo && v <= hi) ? v : null;
  const vixOk = m.vix ? nd(m.vix.value, 0.1, 200) : null;   // VIX negativo o assurdo = glitch
  // v164: il VIX si dichiarava "rilevazione odierna" SEMPRE, anche col mercato chiuso — unico dato
  // del payload a contraddire il CONTESTO DI SESSIONE e le celle prezzo "[chiusura del GG/MM]".
  // E' proprio l'indicatore su cui il CIO calibra rischio e sizing: farlo sembrare posteriore alla
  // chiusura induce a credere che esista una misura di volatilita' piu' fresca dei prezzi.
  if (vixOk != null) {
    // v193 — MERCATO APERTO NON SIGNIFICA DATO FRESCO. La condizione guardava solo l'orologio:
    // il 31/07 a borsa aperta il payload scriveva "VIX 18,58 (-0,64% oggi — rilevazione
    // odierna)" mentre lo snapshot era del 26/07, cioe' cinque giorni prima. E' la stessa
    // classe dell'etichetta KOSPI: lo STATO DEL MERCATO e la FRESCHEZZA DEL DATO sono due
    // cose diverse, e qui servono entrambe vere.
    const snapshotOggi = (() => {
      const u = DATA?.updated_at ? new Date(DATA.updated_at) : null;
      if (!u || isNaN(u)) return false;
      return u.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
    })();
    const vixFresco = usRegularSessionOpen() && snapshotOggi;
    const vixAsof = (() => { const c = lastUsEquityCloseUTC();
      return c ? `[chiusura del ${String(c.at.getUTCDate()).padStart(2, "0")}/${String(c.at.getUTCMonth() + 1).padStart(2, "0")}]` : "[ultima chiusura]"; })();
    lines.push(`- VIX: ${vixOk} (${signTxt(m.vix.change_pct)} ${vixFresco ? "oggi — rilevazione odierna" : `nell'ultima seduta ${vixAsof} — mercato CHIUSO: nessuna rilevazione piu' recente dei prezzi`})`);
  }
  else if (m.vix) lines.push("- VIX: n.d. (valore scartato dal sanity check)");
  if (m.fedwatch) lines.push(`- Fed Funds Rate: range ATTUALE ${m.fedwatch.target_range} · tasso implicito futures ${m.fedwatch.implied_rate}%${m.fedwatch.next_fomc ? ` · PROSSIMA RIUNIONE FOMC: ${new Date(m.fedwatch.next_fomc + "T00:00:00").toLocaleDateString("it-IT")}` : ""} (il tasso resta valido fino alla prossima decisione FOMC)`);
  if (m.carry) {
    let cl = `- Carry USA-Giappone: spread tassi 10A ${fmtNum.format(m.carry.spread)} pp (US10A ${m.carry.us10}%, JGB10A ${m.carry.jp10}%), USD/JPY ${m.carry.usdjpy} (${signTxt(m.carry.usdjpy_chg_1m)} 1 mese)${m.carry.boj_rate != null ? `, tasso BoJ ${m.carry.boj_rate}%` : ""}`;
    if ((m.carry.boj_meetings || []).length) cl += `; prossima riunione BoJ ${new Date(m.carry.boj_meetings[0] + "T00:00:00").toLocaleDateString("it-IT")} (rischio unwind se BoJ alza o lo yen si rafforza)`;
    lines.push(cl);
  }
  if (m.putcall) {
    const r = m.putcall.ratio;
    const bias = r > 1.1 ? "prevalgono put = copertura/pessimismo (estremi = contrarian rialzista)" : r < 0.7 ? "prevalgono call = euforia (estremi = contrarian ribassista)" : "equilibrato";
    lines.push(`- Put/Call ${m.putcall.symbol} (${m.putcall.name}): ${r} — ${bias} (put ${m.putcall.puts}, call ${m.putcall.calls})`);
  }
  if (m.liquidity_split) {
    const L = m.liquidity_split;
    const bits = [];
    if (L.inst_cash_pct != null) bits.push(`Istituzionali Cash: ${fmtNum.format(L.inst_cash_pct)}% (proxy ${L.inst_note || "AUM BIL+SHV vs SPY"})`);
    if (L.retail_mmf_bln != null) bits.push(`Retail Cash: fondi monetari retail $${fmtNum.format(L.retail_mmf_bln)} mld (FRED RMFNS${L.retail_yoy_pct != null ? `, YoY ${signTxt(L.retail_yoy_pct)}` : ""}${L.retail_pctile_5y != null ? `, ${L.retail_pctile_5y}° percentile 5A` : ""})`);
    if (bits.length) lines.push(`- Liquidità in attesa (dry powder di mercato, PROXY dichiarati): ${bits.join(" · ")} — cash alto = benzina potenziale per i rialzi, cash in aumento = de-risking in corso.`);
  }
  if (m.dollar_ruler) {
    const D = m.dollar_ruler;
    lines.push(`- Righello Dollaro (${D.src}): ${D.value} · 3 mesi ${signTxt(D.chg_3m_pct)}${D.flag ? ` ${D.flag} — impatta gli utili esteri delle Large Cap USA (vedi tag FX nelle tabelle)` : " (variazione trimestrale entro ±5%: impatto valutario neutro sugli utili)"}`);
  }
  if (m.momentum) {
    const mo = m.momentum;
    const part = (k, lab) => mo[k] ? `${lab} ${fmtNum.format(mo[k].price)} vs SMA125 ${fmtNum.format(mo[k].sma125)} (${signTxt(mo[k].dist_pct)})` : null;
    const ps = [part("sp500", "S&P 500"), part("ndx", "Nasdaq 100")].filter(Boolean);
    if (ps.length) lines.push(`- Momentum strutturale (prezzo vs SMA125 ≈ 6 mesi): ${ps.join(" · ")} — sopra = trend primario integro, sotto = deterioramento.`);
  }
  // FUTURES USA LIVE (v125): leading indicator prima dell'apertura di Wall Street
  if (m.futures) {
    const fu = m.futures;
    const fp = (k, lab) => fu[k] ? `${lab} ${fmtNum.format(fu[k].price)} (${signTxt(fu[k].change_pct)})` : null;
    const fs = [fp("nasdaq", "Nasdaq 100 (NQ)"), fp("sp500", "S&P 500 (ES)")].filter(Boolean);
    if (fs.length) lines.push(`- Futures USA LIVE (anticipo direzione pre-apertura Wall Street): ${fs.join(" · ")} — negativi marcati = apertura USA in gap-down attesa.`);
  }
  // RADAR SCHIUMA SPECULATIVA v126 (ETF a leva 3x): l'euforia retail terminale sul tech/semi
  // è il contesto in cui questo portafoglio (87% tech) rischia di comprare l'ultimo massimo.
  if (m.froth) {
    const fr = m.froth;
    const fbit = (k, lab) => fr[k] ? `${lab} RVol ${fmtNum.format(fr[k].rvol)}×${fr[k].chg_5d_pct != null ? ` (${signTxt(fr[k].chg_5d_pct)} 5g)` : ""}` : null;
    const fbits = [fbit("soxl", "SOXL 3x semi"), fbit("tqqq", "TQQQ 3x NDX")].filter(Boolean);
    if (fr.alert) {
      lines.push(`- ⚠ [SPECULATIVE FROTH ALERT] Schiuma speculativa sugli ETF a leva: ${fbits.join(" · ")}. ${fr.note || ""} DIRETTIVA: è in corso una speculazione estrema sui prodotti a leva tech — NON impegnare il budget operativo in NUOVI acquisti tech/semi finché il volume non si normalizza; le posizioni esistenti restano protette SOLO dagli Stop Ratchet 2×ATR (non alzarli, non anticiparli). La riserva ES95 resta inviolabile.`);
    } else if (fbits.length) {
      lines.push(`- Schiuma speculativa ETF leva 3x (proxy euforia retail): ${fbits.join(" · ")} — entro la norma (alert a RVol ≥ 2,5× con prezzo in salita a 5 sedute).`);
    }
  }
  // PROXY AMPIEZZA DI MERCATO v126 (SPY vs RSP): un rally retto da poche megacap è la
  // fragilità specifica di un book concentrato su NVDA/MU/AMD.
  if (m.breadth) {
    const br = m.breadth;
    const base = `SPY (cap-pesato) ${signTxt(br.spy_1m_pct)} vs RSP (equi-pesato) ${signTxt(br.rsp_1m_pct)} a 1M · spread ${signTxt(br.divergence_pp, "pp")}`;
    if (br.alert) {
      lines.push(`- ⚠ [BREADTH DIVERGENCE] Ampiezza di mercato in deterioramento: ${base}. ${br.note || ""} DIRETTIVA: il rally NON è confermato dall'azione media — prudenza sui nuovi ingressi (sizing ridotto o ingresso post-conferma), priorità ai candidati con RS propria e non trainata dall'indice; per il book già concentrato sulle megacap questo è il segnale d'allarme più specifico: verifica la distanza degli stop ratchet.`);
    } else {
      lines.push(`- Ampiezza di mercato (SPY cap-pesato vs RSP equi-pesato, 1M): ${base} — rally ${br.divergence_pp > 2 ? "trainato dalle megacap ma con partecipazione" : "con partecipazione ampia"} (alert se SPY+ con RSP− o spread >4pp).`);
    }
  }
  // EUR/JPY escluso dal payload (v138): ridondante — il rischio yen è già nel blocco Carry
  // USA-Giappone (USD/JPY + tasso BoJ), e il rischio cambio del fondo è EUR/USD.
  (m.markets || []).filter(x => !/EUR\/JPY/i.test(x.label || "")).forEach(x => lines.push(`- ${x.label}: ${x.value} (${signTxt(x.change_pct, x.suffix || "%")} oggi)`));
  // ogni indicatore economico con la sua data di pubblicazione ESPLICITA: la latenza del dato
  // deve essere palese all'AI (CPI/NFP = mensili con ~1 mese di ritardo; PIL = trimestrale)
  /* ═══ v229 — ACCORPAMENTO NEL PAYLOAD (era già stato fatto in dashboard in v225) ══════════
     Il QUADRO MACRO pubblicava l'inflazione su DUE righe (CPI e PCE, oggi entrambe 3.7%) e la
     curva 10A-2A su TRE (questa, quella dedicata con la distanza dall'inversione, e quella del
     modello recessione). Nessuna delle tre era sbagliata, ma un lettore che conta i segnali ne
     conta tre dove ce n'è uno: è la stessa classe che il payload dichiara già altrove
     ("NON è una seconda conferma indipendente… contarli come due prove raddoppia un segnale
     solo"), applicata qui invece che solo annotata.
     · CPI e PCE → una riga sola, entrambi i numeri, con quale guarda la Fed.
     · curva → esce da questo elenco e la sua RILEVAZIONE si trasferisce alla riga dedicata,
       che è la sola a portare la distanza dall'ultima inversione. */
  /* ⚠ `curve` esce dall'elenco SOLO se la riga dedicata verra' davvero emessa (serve
     curve_history). Senza questa condizione, uno snapshot senza storico della curva la faceva
     SPARIRE dal payload: un accorpamento che perde il dato invece di unirlo. Preso dal test
     v138, che asserisce l'etichetta "serie GIORNALIERA" — la guardia proteggeva la label e ha
     intercettato la perdita del fatto. */
  const curvaAltrove = (m.curve_history || []).length > 0;
  const accorpate = new Set(curvaAltrove ? ["cpi", "pce", "curve"] : ["cpi", "pce"]);
  const noteSerie = (i) => i.key === "gdp" ? "serie TRIMESTRALE, il dato più recente disponibile"
    : i.key === "curve" ? "serie GIORNALIERA FRED T10Y2Y, ultima chiusura"
    : i.key === "umich" ? "serie mensile via FRED UMCSENT, che sconta 1-2 mesi di ritardo di LICENZA: alla fonte UMich esistono già letture più recenti NON presenti qui — verificale prima di trarne conclusioni sul consumatore"
    : "serie mensile, normale ritardo di pubblicazione";
  (m.indicators || []).filter(i => !accorpate.has(i.key)).forEach(i => {
    /* v250 — dove esiste un calendario dichiarato dalla fonte si scrive QUANDO è stato rilevato,
       quanti giorni ha e QUANDO ne arriva uno nuovo. Altrove resta la nota generica: meglio una
       nota vaga che una data inventata. */
    const cad = rigaCadenza(i.key, i.date);
    lines.push(`- ${i.label}: ${i.value} (${cad || `rilevazione ${i.date} — ${noteSerie(i)}`})${dqV.flags[i.key] ? " " + dqV.flags[i.key] : ""}`);
  });
  {
    const c2 = (m.indicators || []).find(i => i.key === "cpi");
    const p2 = (m.indicators || []).find(i => i.key === "pce");
    const fl = [c2, p2].filter(Boolean).map(i => dqV.flags[i.key]).filter(Boolean).join(" ");
    if (c2 && p2) lines.push(`- Inflazione (a/a): CPI ${c2.value} · PCE ${p2.value} — due misure della STESSA grandezza, non due segnali: la Fed guarda il PCE. Rilevazioni: CPI ${rigaCadenza("cpi", c2.date) || c2.date} · PCE ${rigaCadenza("pce", p2.date) || p2.date}.${fl ? " " + fl : ""}`);
    else if (c2 || p2) {
      const u = c2 || p2;
      /* v250 — la riga di cadenza sostituisce il generico "normale ritardo di pubblicazione":
         dice QUANDO è stato rilevato, quanti giorni ha, e QUANDO ne arriva uno nuovo. È la
         risposta strutturale al dubbio del CEO sul margin debt — un dato vecchio con la data
         del prossimo è informazione, lo stesso dato senza è una trappola. */
      const cad = rigaCadenza(u.key, u.date);
      lines.push(`- ${u.label}: ${u.value} (${cad || `rilevazione ${u.date} — serie mensile, normale ritardo di pubblicazione`})${dqV.flags[u.key] ? " " + dqV.flags[u.key] : ""}`);
    }
  }
  if (m.macroquant) lines.push(`- MacroQuant (ciclo economico, stile BCA): ${m.macroquant.label} (${m.macroquant.score}/100)`);
  if (m.signposts) lines.push(`- BofA Bear-Market Signposts: ${m.signposts.active}/10 attivi (${m.signposts.pct}% rischio ribassista)`);
/* ═══ v246 — LA LEVA È UNA FOTOGRAFIA DI DUE MESI FA, E IL KOSPI LO DICE ═══════════════════
   Segnalato dal CEO: "il grafico porta ancora la leva al massimo ma sembra che ci sia stata una
   pulizia della leva (vedi calo KOSPI), forse c'e' un calcolo errato".
   IL CALCOLO NON E' SBAGLIATO: l'ultimo punto della serie E' il massimo, quindi 100% e' esatto.
   Sbagliata era la PRESENTAZIONE. Due cose che il payload non diceva:
   1. QUANTO E' VECCHIO. Scriveva "(rilevazione 2026-06-01)" e lasciava fare la sottrazione a chi
      legge. Sono 68 giorni. FINRA pubblica il mese M nella terza settimana di M+1, quindi giugno
      E' il dato piu' recente che esista — ma "piu' recente disponibile" e "attuale" sono cose
      diverse, e un LLM che legge "leva al massimo" senza l'eta' conclude sul presente.
   2. CHE NEL FRATTEMPO E' SUCCESSO. Il sistema HA la prova e non la collegava: il KOSPI e' in
      drawdown profondo, ed e' l'indice dove la leva retail e' piu' visibile al mondo. Verificato
      su fonti aperte il 07/08/2026: i prestiti a margine coreani sono passati da 38,6 T won di
      fine giugno a 27,4 T del 4 agosto. Un deleveraging gia' avvenuto, che una serie FINRA di
      giugno non puo' contenere per costruzione.
   ⚠ Non si INVENTA un dato piu' fresco: si dichiara l'eta' e si nomina l'evidenza contraria che
   il payload gia' contiene. La differenza fra un dato vecchio spacciato per attuale e un dato
   vecchio dichiarato tale e' tutta la fiducia che si puo' avere nel sistema. */
function etaLeva(md) {
  try {
    const d = new Date(String(md.date).slice(0, 10) + "T00:00:00");
    if (isNaN(d)) return null;
    const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
    return Math.round((oggi - d) / 86400000);
  } catch { return null; }
}
/* il KOSPI come testimone: e' l'indice dove la leva retail e' piu' visibile, e il payload lo
   porta gia' fra gli anticipatori. Qui si legge il suo DRAWDOWN, non il movimento di giornata:
   un unwind e' una discesa profonda, non una seduta storta. */
function testimoneLeva() {
  const k = (DATA?.watchlist || []).find(r => r.ticker === "^KS11" || r.ticker === "KOSPI");
  if (!k) return null;
  /* ⚠ il campo si chiama `w52_dist_pct`, non `drawdown_52w`: il nome va LETTO dal file, non
     indovinato. Con la chiave sbagliata la funzione tornava null e il testimone non compariva
     mai — un ramo silenziosamente morto, la classe v234. */
  const dd = k.w52_dist_pct != null ? Number(k.w52_dist_pct) : null;
  if (dd == null || isNaN(dd)) return null;
  const m1 = k.rs_ndx_1m != null ? Number(k.rs_ndx_1m) : null;
  return { dd, m1 };
}
    /* v249 — MARGIN DEBT FUORI DAL PAYLOAD, su dubbio del CEO: "forse è troppo datato e
       diventa fuorviante per l'analisi". Aveva ragione, e la misura lo conferma: la rilevazione
       è di 68 giorni (FINRA pubblica il mese M nella terza settimana di M+1, quindi giugno È il
       dato più recente che esista) MA veniva presentata come uno STATO — "Espansione leva
       ESTREMA → RISCHIO SISTEMICO" — su una variabile che nel frattempo si è mossa molto: nello
       stesso intervallo i prestiti a margine coreani sono passati da 38,6 a 27,4 T won.
       ⚠ Non è un dato INAFFIDABILE: è onesto ma LENTO, etichettato come se fosse attuale. v246
       aveva aggiunto l'età e il testimone KOSPI, e non è bastato: l'etichetta di rischio
       sistemico resta la prima cosa che si legge. Fuori dal payload; RESTA in dashboard, dove
       il CEO lo guarda sapendo di che mese è. `etaLeva`/`testimoneLeva` restano: le usa la card,
       e portarsele via sarebbe il taglio che prende il vicino (classe v201-v204). */
  if (m.forward_pe && m.forward_pe.value != null) {
    const fp = m.forward_pe;
    // v169 — l'escalation NON può poggiare su un dato vecchio senza dirlo. Il Forward P/E viene
    // dal WSJ, che gli IP dei runner CI trovano spesso bloccato: in quei run il valore è un
    // carry-forward fino a 45 giorni. Verificato che non esiste un'alternativa gratuita stabile
    // (multpl non ha la pagina forward, gurufocus risponde 403, yfinance non espone forwardPE per
    // gli ETF sull'indice; un proxy calcolato bottom-up sui mega-cap sbaglia ~10%, troppo vicino
    // alla soglia di 20 per pilotare un verdetto). Quindi: il verdetto sistemico si declassa a
    // ipotesi quando l'input non è fresco, invece di affermarlo con la stessa sicurezza.
    const fpAgeDays = (() => { const d = fp.fetched_at || fp.date; if (!d) return null;
      const t = new Date(d); return isNaN(t) ? null : Math.round((Date.now() - t) / 86400000); })();
    const fpStale = !!fp.carried || (fpAgeDays != null && fpAgeDays > 21);
    const sysDanger = (m.margin_debt?.pct_of_peak >= 90) && fp.value > 20;
    const carriedTag = (o) => {
      if (!o || !o.carried) return "";
      const d = o.fetched_at || o.date;
      const age = d ? Math.round((Date.now() - new Date(d)) / 86400000) : null;
      return `, ⚠ CARRY-FORWARD dal run precedente${d ? ` (rilevato ${String(d).slice(0, 10)}${age != null ? `, ${age}g fa` : ""})` : ""} — la fonte era irraggiungibile: pesalo come dato DATATO, non odierno`;
    };
    lines.push(`- Forward P/E S&P 500 [FORWARD, fonte: ${fp.source || "WSJ"}${carriedTag(fp)} — metodologia DIVERSA dal trailing: NON derivarne tassi di crescita impliciti]: ${fp.value}× vs media storica ${fp.avg_hist}× (${fp.label}). ${sysDanger ? (fpStale ? `RISCHIO SISTEMICO da VERIFICARE: leva ai massimi e valutazioni tese porterebbero a un giudizio di vulnerabilità a un deleveraging violento, MA questo Forward P/E non è fresco${fpAgeDays != null ? ` (${fpAgeDays}g)` : ""} — il verdetto poggia su un input datato: confermalo via web prima di usarlo come premessa.` : "RISCHIO SISTEMICO ELEVATO: leva ai massimi + valutazioni tese → vulnerabilità a deleveraging violento.") : "Valutazioni " + (fp.value > 20 ? "tese ma" : "") + " da monitorare insieme alla leva."}`);
  }
  if (m.credit) {
    let crl = `- Rischio Credito (HY OAS, proxy CDS): ${m.credit.spread_hy}% — ${m.credit.label} (score ${m.credit.score}/100; <4% normale, 5-7% stress, >9% crisi)`;
    const ch = m.credit.history || [];
    if (ch.length > 20) { const d = ch[ch.length - 1].v - ch[ch.length - 21].v; crl += `; trend ~1 mese ${d > 0 ? "+" : ""}${fmtNum.format(Math.round(d * 100) / 100)} pp (${d > 0.15 ? "spread in allargamento = rischio in aumento" : d < -0.15 ? "spread in restringimento = rischio in calo" : "stabile"})`; }
    lines.push(crl);
  }
  if (m.systemic_risk) {
    const sr = m.systemic_risk;
    lines.push(`- Rischio Sistemico & Credito (proxy CDS): HY OAS ${sr.hy_oas}% (${signTxt(sr.hy_chg_1m)} 1m), IG OAS ${sr.ig_oas ?? "—"}% (ICE BofA US Corporate, indice IG AMPIO · ${sr.ig_chg_1m != null ? signTxt(sr.ig_chg_1m) : "—"} 1m), HY/IG ${sr.hy_ig ?? "—"}×${sr.stlfsi != null ? `, stress finanziario St.Louis ${signTxt(sr.stlfsi)}` : ""} — ${sr.status}`);
  }
  if (m.smart_money) {
    const sm = m.smart_money;
    let l = `- Istituzionali VS Retail: ${sm.label} (${sm.score}/100, basato su SMC di S&P 500 e Nasdaq + VIX term + HY/IG + put/call)`;
    const si = sm.smc_indices || {};
    const idxTxt = Object.values(si).map(s => `${s.label_idx}: struttura ${s.structure}, BOS ${s.bos || "n/d"}, FVG ${s.bull_fvg}↑/${s.bear_fvg}↓, bias ${s.bias}/100`).join(" · ");
    if (idxTxt) l += `. SMC indici → ${idxTxt}`;
    if (sm.vix_term_ratio != null) l += `. VIX/VIX3M ${fmtNum.format(sm.vix_term_ratio)} ${sm.vix_term_ratio > 1 ? "(backwardation=tensione)" : "(contango=calma)"}`;
    // denominatore DIVERSO dalla riga "Rischio Sistemico & Credito": qui e' il BBB, la fascia piu'
    // bassa dell'investment grade, dove la fuga verso la qualita' si vede per prima. Il nome lo
    // dice, cosi' i due rapporti non si leggono come lo stesso numero che si contraddice.
    if (sm.hy_ig_ratio != null) l += `, HY/BBB ${fmtNum.format(sm.hy_ig_ratio)}× (${sm.ig_spread != null ? `BBB ${fmtNum.format(sm.ig_spread)}%, ` : ""}fascia IG piu' bassa — NON lo stesso denominatore di HY/IG sopra)`;
    const fgBp = m.fear_greed?.score;
    if (fgBp != null) {
      if (fgBp > 75 && sm.score < 30)
        l += ` — *** ALERT DIVERGENZA PERICOLOSA: retail F&G ${fgBp}/100 (LONG ESTREMO) vs istituzionali ${sm.score}/100 (SHORT) — rischio distribuzione imminente, storicamente precede correzioni ***`;
      else if (fgBp < 25 && sm.score > 70)
        l += ` — *** ALERT ACCUMULO ISTITUZIONALE: retail F&G ${fgBp}/100 (PAURA ESTREMA) vs istituzionali ${sm.score}/100 (AGGRESSIVI) — possibile bottom, setup rialzista ***`;
      else if (sm.divergence != null) l += ` — divergenza col retail: ${sm.divergence_label}`;
    } else if (sm.divergence != null) {
      l += ` — divergenza col retail: ${sm.divergence_label}`;
    }
    lines.push(l);
    // SMC per titolo del portafoglio
    const ptfSmc = (DATA.portfolio || []).filter(r => r.smc);
    if (ptfSmc.length) {
      lines.push("- SMC per titolo (struttura/BOS/FVG/bias): " + ptfSmc.map(r => `${r.ticker} ${r.smc.structure}${r.smc.bos ? "/BOS " + r.smc.bos : ""} FVG ${r.smc.bull_fvg}↑${r.smc.bear_fvg}↓ bias ${r.smc.bias}`).join(" · "));
    }
  }
  if (m.decouple?.sp500?.length && m.decouple?.gdp?.length) {
    const gg = sovrapposizioneGiorni(m.decouple.sp500, m.decouple.gdp);
    if (gg) {
      const gap = Math.round(m.decouple.sp500.slice(-1)[0].v - m.decouple.gdp.slice(-1)[0].v);
      const anni = Math.round(gg / 365 * 10) / 10;
      lines.push(`- Disaccoppiamento S&P 500 vs PIL reale: gap ${gap > 0 ? "+" : ""}${gap} pp su una finestra di ${anni} anni (azionario ${signTxt(Math.round((m.decouple.sp500.slice(-1)[0].v - 100) * 10) / 10)} contro PIL reale ${signTxt(Math.round((m.decouple.gdp.slice(-1)[0].v - 100) * 10) / 10)} dal ${m.decouple.sp500[0].d}). ⚠ COME SI LEGGE: è una differenza CUMULATA, quindi cresce meccanicamente con la lunghezza della finestra — la soglia dei "40 pp" citata in letteratura NON è confrontabile con finestre di durata diversa, e su ${anni} anni di mercato al rialzo viene superata quasi sempre. Serve come contesto di valutazione, NON come segnale di uscita.`);
    } else {
      lines.push(`- Disaccoppiamento S&P 500 vs PIL reale: NON CALCOLABILE in questo snapshot — le due serie non condividono nessun periodo (azionario e PIL arrivano con finestre diverse), quindi la loro differenza non sarebbe un gap ma il confronto fra due orizzonti diversi. Si ricalcola da solo al prossimo run della pipeline.`);
    }
  }
  if ((m.curve_history || []).length) {
    const cv = m.curve_history.slice(-1)[0].v;
    // v193 — "DIS-INVERSIONE IN CORSO" NON PUO' ESSERE INCONDIZIONATO. Il payload lo scriveva
    // ogni volta che la curva era positiva, anche con l'ultima inversione a 469 sedute (~22 mesi)
    // di distanza: un evento concluso da quasi due anni presentato come processo in atto, con
    // tutta la carica di urgenza che "in corso" porta con se'. Ora la distanza dall'inversione
    // decide la frase, e il numero di sedute e' scritto accanto perche' il lettore lo veda.
    // sedute dall'ultima inversione: si contano dalla serie che il payload gia' possiede
    // (curve_history, 501 punti), non da un campo che la pipeline non produce.
    const inv = (() => {
      const h = (m.curve_history || []).map(x => (x && typeof x === "object" ? x.v : x));
      if (!h.length) return null;
      let n = 0;
      for (let i = h.length - 1; i >= 0; i--) { if (!(h[i] > 0)) break; n++; }
      return n === h.length ? null : n;      // mai invertita nella finestra: non si afferma nulla
    })();
    const desc = cv < 0 ? "ancora invertita = rischio recessione"
      : inv != null && inv > 250 ? `positiva da tempo — l'ultima inversione risale a ${inv} sedute fa, quindi NON è una dis-inversione in corso ma una curva normalizzata da tempo`
      : inv != null ? `tornata positiva dopo l'inversione di ${inv} sedute fa = dis-inversione recente`
      : "positiva (distanza dall'ultima inversione non disponibile: non se ne deduce se la dis-inversione sia recente)";
    const cIn = (m.indicators || []).find(i => i.key === "curve");
    lines.push(`- Curva 10A-2A: ${cv > 0 ? "+" : ""}${cv} pp${cIn ? ` (rilevazione ${cIn.date}, serie GIORNALIERA FRED T10Y2Y, ultima chiusura)` : ""} — ${desc}${cIn && dqV.flags.curve ? " " + dqV.flags.curve : ""}`);
  }
  if (m.yield_recession) {
    const yr = m.yield_recession;
    // v229 — NON ripete il valore della curva: e' lo STESSO numero della riga sopra, e ripeterlo
    // lo faceva sembrare una seconda rilevazione. Qui sta solo cio' che questa riga aggiunge:
    // il confronto a 12 mesi del modello storico e la regola dell'irripidimento.
    lines.push(`- Curva vs Recessione (modello storico FRED, stessa curva della riga qui sopra): ${yr.curve_12m_ago != null ? `12m fa ${yr.curve_12m_ago > 0 ? "+" : ""}${yr.curve_12m_ago} pp (media mensile del modello)` : "confronto a 12 mesi non disponibile"}, ${yr.label}. PIL reale YoY ${yr.gdp_last != null ? yr.gdp_last + "%" : "—"}, sussidi disocc. ${yr.claims_last ?? "—"}. ${yr.steepening ? "NB: la curva si sta IRRIPIDENDO dopo l'inversione — storicamente questa configurazione ha preceduto una recessione entro ~12 mesi (la curva shiftata di 12m anticipa il calo del PIL)." : `NB: la curva NON si sta irripidendo (oggi ${yr.current_curve} contro ${yr.curve_12m_ago} di 12 mesi fa): la regola \"irripidimento post-inversione → recessione entro ~12 mesi\" NON è attiva adesso, e va citata solo se e quando lo diventa.`}`);
  }
  // ═══ v203 — MEMORIA STORICA e CICLO DEI SEMICONDUTTORI: RIMOSSI su decisione del CEO.
  // Erano gli unici due blocchi che non avevano MAI girato con dati veri: FRED non risponde
  // dall'ambiente di sviluppo, quindi logica e rendering erano provati (22 test + dati
  // simulati) ma la FETCH no. E uno dei due lo dimostrava: scorte/spedizioni a 2,16 quando il
  // rapporto di settore sta intorno a 1,3-1,5, cioe' quasi certamente la serie sbagliata fra i
  // candidati provati. Pubblicare un percentile su una serie che non e' quella che dichiari e'
  // peggio che non pubblicarlo: da' l'autorita' di un dato storico a un numero che non lo e'.
  // Con loro se ne va anche tutto il codice FRED a serie lunghe (storia_lunga,
  // ciclo_semiconduttori, historical_context.py e i suoi test): non serviva ad altro.

  // v186 — FedWatch mostra il ramo ATTIVO, non solo i tagli. "prob. taglio 0%" era vero e
  // inutile: a fine luglio 2026 il mercato prezzava un RIALZO al 38% e il payload taceva.
  // In più: quando Polymarket quota lo stesso evento con un numero diverso, la divergenza è
  // essa stessa informazione (fonti che non concordano su una riunione a giorni), quindi le
  // due cifre vanno AFFIANCATE invece di pubblicarne una sola. Sono FATTI: niente giudizio.
  if (m.fedwatch && (m.fedwatch.meetings || []).length) {
    // v207 — la derivazione dei rami vive ora in ramiFedWatch(), condivisa col popup della
    // dashboard: erano due implementazioni della stessa cosa e una delle due era rimasta a metà.
    const mt = ramiFedWatch(m.fedwatch, m.fedwatch.meetings[0]);
    // v193 — TUTTI E TRE I RAMI, SEMPRE, anche a zero (richiesta CEO). Il v187 mostrava solo
    // quelli attivi: uno zero esplicito e' informazione ("il mercato non prezza affatto un
    // taglio"), mentre l'assenza della voce lascia il dubbio che il dato manchi.
    const rami = [
      `RIALZO ${mt.hike_prob ?? 0}%`,
      `invariato ${mt.hold_prob ?? 0}%`,
      `taglio ${mt.cut_prob ?? 0}%`,
    ];
    // stessa riunione quotata su Polymarket? (i mercati di previsione sono già nel payload)
    const pm = (DATA.predictions || []).find(x => /\bfed\b/i.test(x.question || "") && /increase|hike|raise/i.test(x.question || ""));
    // il campo di Polymarket in data.json si chiama `yes` ed e' gia' in percentuale (17 = 17%);
    // si accettano anche le forme 0-1 e `probability` per non dipendere da un solo formato.
    const pmRaw = pm ? (pm.yes ?? pm.probability) : null;
    const pmPct = pmRaw != null ? Math.round(pmRaw > 1 ? pmRaw : pmRaw * 100) : null;
    const scarto = (pmPct != null && mt.hike_prob) ? Math.abs(pmPct - mt.hike_prob) : null;
    const conf = scarto != null
      ? ` · lo stesso esito su Polymarket è quotato ${pmPct}%${scarto >= 10 ? ` — le due fonti divergono di ${scarto} punti sulla stessa riunione` : ""}`
      : "";
    // ═══ v199 — IL CONTRATTO NON PREZZA QUELLA RIUNIONE. ZQ=F e' il future Fed Funds a 30
    // giorni sul MESE CORRENTE: prezza la media del mese in corso, non una riunione fra sei
    // settimane. Il 31/07 il payload ne ricavava "RIALZO 2%" per la riunione del 16/09 mentre
    // Polymarket, che quota proprio settembre, dava 56% — 54 punti di divergenza che sembravano
    // disaccordo fra fonti e invece erano un ERRORE DI ORIZZONTE del nostro calcolo.
    // Quando la riunione e' oltre la copertura del contratto non si pubblica una probabilita'
    // che non significa nulla: si dichiara il limite e si indica la fonte che quella riunione
    // la prezza davvero. Un numero fuori orizzonte e' peggio di nessun numero.
    const giorniAllaRiunione = (() => {
      const d = new Date(mt.date + "T00:00:00");
      return isNaN(d) ? null : Math.round((d - new Date()) / 86400000);
    })();
    const fuoriOrizzonte = giorniAllaRiunione != null && giorniAllaRiunione > 35;
    if (fuoriOrizzonte) {
      lines.push(`- FedWatch — NON CALCOLABILE per la riunione del ${mt.date} (fra ${giorniAllaRiunione} giorni): il tasso implicito ${m.fedwatch.implied_rate}% viene dal future Fed Funds a 30 giorni, che prezza il MESE IN CORSO e non una riunione così lontana. Le probabilità derivate da quel contratto non riguarderebbero quella data.`
        + (pmPct != null ? ` La fonte che quota proprio quella riunione è il mercato di previsione: rialzo ${pmPct}%.` : " Nessun mercato di previsione disponibile su quella riunione in questo payload."));
    } else {
      lines.push(`- FedWatch prossima riunione ${mt.date}${giorniAllaRiunione != null ? ` (fra ${giorniAllaRiunione} giorni)` : ""} (dai futures sui Fed Funds a 30 giorni: tasso implicito ${m.fedwatch.implied_rate}% vs punto medio del range attuale): ${rami.join(" · ")}${conf}`);
    }
  }
  if ((m.tilt || []).length) {
    lines.push("");
    lines.push("ROTAZIONE SETTORIALE/TEMATICA USA (ETF, performance 1M e 3M):");
    [...m.tilt].sort((a, b) => b.m1 - a.m1).forEach(s =>
      lines.push(`- ${s.name} (${s.ticker}): 1M ${signTxt(s.m1)}, 3M ${signTxt(s.m3)}`));
  }
  if (m.sp500_pe) {
    const cf = m.sp500_pe.carried ? `, ⚠ CARRY-FORWARD dal run precedente${m.sp500_pe.fetched_at || m.sp500_pe.date ? ` (rilevato ${String(m.sp500_pe.fetched_at || m.sp500_pe.date).slice(0, 10)})` : ""} — fonte irraggiungibile: dato DATATO` : "";
    let peLine = `- P/E Ratio S&P 500 [TRAILING, fonte: ${m.sp500_pe.source || "FRED/multpl"}${cf}]: ${m.sp500_pe.current}× (${m.sp500_pe.label})${m.sp500_pe.avg_10y != null ? ` · media 10A ${m.sp500_pe.avg_10y}×` : ""}${m.sp500_pe.pct_rank != null ? ` · percentile storico ${m.sp500_pe.pct_rank}°` : ""}`;
    if (m.sp500_pe.nasdaq_pe) peLine += ` · Nasdaq 100 (QQQ) P/E: ${m.sp500_pe.nasdaq_pe}× (tech solitamente a premio; >35× = valutazioni tese)`;
    lines.push(peLine);
  }
  if (m.corp_profit) {
    const ggCp = sovrapposizioneGiorni(m.corp_profit.sp500, m.corp_profit.profits);
    let cpBp = ggCp
      ? `- S&P 500 & Nasdaq 100 vs Profitti Aziendali Reali (FRED CP): S&P gap ${m.corp_profit.gap > 0 ? "+" : ""}${m.corp_profit.gap} pp`
      : `- S&P 500 & Nasdaq 100 vs Profitti Aziendali Reali (FRED CP): il gap dell'S&P NON è calcolabile in questo snapshot (la sua serie e quella dei profitti non condividono nessun periodo)`;
    if (m.corp_profit.ndx_gap != null) cpBp += `, NDX gap ${m.corp_profit.ndx_gap > 0 ? "+" : ""}${m.corp_profit.ndx_gap} pp`;
    cpBp += ` — ${m.corp_profit.label} (score ${m.corp_profit.score}/100; gap>40 = Asset Inflation da fiat debasement, non crescita utili reali). ⚠ NON è una seconda conferma indipendente del Disaccoppiamento qui sopra: entrambi misurano "l'azionario è salito più dell'economia reale" su una finestra pluriennale, con denominatori diversi (PIL contro profitti). Contarli come due prove separate raddoppia un segnale solo.`;
    lines.push(cpBp);
  }
  if (m.fed_market) lines.push(`- Fed Funds Rate attuale: ${m.fed_market.current_rate}% (rilevazione ${m.fed_market.rate_date}); tasso>4% storicamente comprime i multipli P/E in 12-18 mesi`);
  // 4 streghe SOLO se imminenti (v138): a >30 giorni è rumore senza valore operativo
  if (m.witching && m.witching.days != null && m.witching.days < 30) lines.push(`- Prossime "4 streghe" (quadruple witching): ${new Date(m.witching.next).toLocaleDateString("it-IT")} (tra ${m.witching.days} gg — volumi record e prezzo "attratto" dai muri di opzioni: prudenza sugli ordini a ridosso)`);
  // salute del portafoglio (blend tecnica + macro + fondamentale)
  if (typeof portfolioHealthScore === "function") {
    const ph = portfolioHealthScore();
    if (ph != null) {
      const parts = (typeof portfolioHealthParts === "function") ? portfolioHealthParts() : [];
      lines.push(`- Salute del portafoglio (blend): ${ph}/100${parts.length ? ` [${parts.map(p => `${p[0]} ${p[1]}`).join("; ")}]` : ""}`);
    }
  }
  // concentrazione per settore (utile per il de-risking)
  const alloc = DATA.allocation || [];
  if (alloc.length) {
    const tot = alloc.reduce((s, a) => s + (a.value_eur || 0), 0) || 1;
    const bySec = {};
    alloc.forEach(a => { const k = a.sector || a.ticker; bySec[k] = (bySec[k] || 0) + (a.value_eur || 0); });
    const secs = Object.entries(bySec).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v / tot * 100)}%`);
    // ⚠ v222 — questa riga finiva con "portafoglio fortemente sbilanciato sul tech/semi →
    // priorità al de-risking": un ORDINE dentro il payload, che deve portare solo FATTI (il
    // detector C9 non l'ha preso perché cerca imperativi in SECONDA PERSONA e quello era un
    // sostantivo). In v221 avevo tolto l'ordine ma scritto la SPIEGAZIONE dentro il payload —
    // che è lo stesso errore due volte: la nota spiegava un difetto a chi legge il prompt,
    // e ripeteva pure la frase incriminata. La spiegazione vive qui, nel codice.
    lines.push(`- Concentrazione per settore (% del PATRIMONIO TOTALE, liquidità e obbligazioni incluse, somma 100%): ${secs.join(" · ")}. NB: la "regola correlazione >25%" nelle METRICHE DI RISCHIO usa invece la % del solo capitale azionario — denominatore diverso, non un'incoerenza.`);
  }
  // IDEE DI ROTAZIONE (v144): compounder di qualità ESTERNI al portafoglio, dai settori in
  // accelerazione — la materia prima POSITIVA per rompere la monocultura tech. Dati reali dal
  // motore (ROE, RS, PEG): l'LLM le VALUTA, non le esegue (vanno prima messe in watchlist).
  const scr = DATA.screener || [];
  if (scr.length) {
    lines.push("");
    lines.push("IDEE DI ROTAZIONE (screening automatico — compounder ad alta ROE (non ROIC: vedi nota della tabella fondamentale) ESTERNI al portafoglio, dai settori che stanno ACCELERANDO; servono a de-concentrare la monocultura tech/semi con nomi a bassa correlazione. NON sono ordini né candidati: sono nomi ESTERNI al portafoglio, non ancora passati dal motore né dai veti):");
    lines.push("| Titolo | Settore (ETF 1M) | Prezzo | 1M | RS 1M vs NDX | ROE | Cresc.ricavi | Fwd P/E | PEG | Upside target | RSI |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
    scr.forEach(r => lines.push(`| ${r.name} (${r.ticker}) | ${r.sector_name}${r.sector_m1 != null ? ` (${signTxt(r.sector_m1)})` : ""} | $${fmtNum.format(r.price)} | ${signTxt(r.m1_pct)} | ${r.rs_ndx_1m != null ? signTxt(r.rs_ndx_1m, "pp") : "—"} | ${r.roe_pct != null ? signTxt(r.roe_pct) : "—"} | ${r.rev_growth_pct != null ? signTxt(r.rev_growth_pct) : "—"} | ${r.forward_pe ?? "—"} | ${r.peg ?? "—"} | ${r.target_upside_pct != null ? signTxt(r.target_upside_pct) : "—"} | ${r.rsi ?? "—"} |`));
  }
  // statistiche di performance dal broker
  if (DATA.broker) {
    const b = DATA.broker;
    const pf = [];
    if (b.ytd_pct != null) pf.push(`YTD ${signTxt(b.ytd_pct)}`);
    if (b.y1_pct != null) pf.push(`1 anno ${signTxt(b.y1_pct)}`);
    if (b.inception_pct != null) pf.push(`dall'inizio ${signTxt(b.inception_pct)}`);
    if (pf.length) lines.push(`- Performance storica (broker): ${pf.join(" · ")}`);
  }
  // liquidità e capitale
  // "controvalore (mark-to-market)", NON "capitale investito": la SITUAZIONE PATRIMONIALE usa
  // già "capitale investito (costo)" per il costo storico — stesso nome per due grandezze
  // diverse (175k costo vs 287k MTM) mandava in confusione l'LLM ricevente
  if (t.cash) lines.push(`- Liquidità disponibile: ${fmtEUR.format(t.cash)} · controvalore investito (mark-to-market): ${fmtEUR.format(t.eur_invested)}`);
  // TOP 10 CAPITALIZZAZIONI rimosso dal payload (v138): nessun valore decisionale per il
  // fondo (i nomi rilevanti sono già in ptf/watchlist con dati completi); resta nella UI.
  // TOP 10 ETF: RIMOSSO dal payload (v184), come TOP 10 CAPITALIZZAZIONI in v138 — e resta nella UI.
  // Non e' stato citato in nessuno dei tre report reali di LLM diversi sullo stesso payload, e la
  // rotazione che serve davvero e' gia' in ROTAZIONE SETTORIALE (21 ETF con performance 1M e 3M).
  if ((DATA.predictions || []).length) {
    lines.push("");
    recordPolymarket();   // registra lo snapshot di oggi (dedup giornaliero) per la derivata Δ7g
    lines.push("MERCATI DI PREVISIONE (Polymarket, prob. Sì · [Δ7g] = velocità del sentiment speculativo macro — accelerazioni repentine sulle aspettative tassi Fed pesano di più):");
    DATA.predictions.forEach(p => { const d = pmDelta7(p.question, p.yes); lines.push(`- ${p.question}: ${p.yes}% [Δ7g ${d == null ? "—" : (d > 0 ? "+" : "") + d + "pp"}]`); });
  }
  lines.push("");
  lines.push("ULTIME NEWS (sentiment | titolo | fonte · tono aggregato nella SINTESI NEWS):");
  (DATA.news || []).slice(0, 12).forEach(n => {
    const s = n.sentiment === "bull" ? "[POS]" : n.sentiment === "bear" ? "[NEG]" : "[NEU]";
    lines.push(`- ${s} [${n.tickers.join(",")}] ${n.title} (${n.source})`);
  });
  lines.push("");
  // Le news per singolo titolo NON si duplicano qui (v145 anti-bloat): vivono nel blocco
  // "NEWS VERTICALE PER TITOLO ATTIVO" più sotto — stessa fonte, titoli in italiano, flag [ptf]
  // e Deduzione Zero. Un solo posto = meno token, niente doppione da riconciliare per l'LLM.
  lines.push("");
  // v180 — PROMEMORIA FINALE RIMOSSO: era un secondo esemplare della testata. Tutti e sei i suoi
  // concetti (ordini a limite, niente domande in chiusura, violazioni dichiarate, assunzione
  // quando un dato manca, forma libera, verifica dei dati datati) sono gia' in [A2] e [D], e
  // ripeterli in coda non li rafforzava: segnalava che il payload non si fida della testata, e
  // consumava l'attenzione finale del lettore su regole invece che su dati.

  return lines.join("\n");
}

function toast(msg, ms = 3200) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/* ============ ANALISI AI (v130) — UN SOLO BOTTONE, un solo flusso ============
   "📋 Copia Analisi AI" genera DAL VIVO (niente file CI, niente LLM di mezzo) il pacchetto
   COMPLETO da incollare in Claude: buildPrompt() intatto (testata utente + payload dati) +
   i DIGEST STORICI (la "lettura quantitativa dei grafici" dei popup: macro, tecnica multi-
   orizzonte, fondamentale profondo) + le news già nel payload. Copia negli appunti e mostra
   la modal per revisione/modifica. Il documento HTML/PDF istituzionale è stato RIMOSSO per
   decisione del CEO (il lettore del report è Claude, non un umano: il testo È il report). */

/* ---------- helpers numerici null-safe (— ovunque manchi il dato) ---------- */
const dgFin = (v) => (v != null && Number.isFinite(Number(v))) ? Number(v) : null;
const dgTxt = (v, suf = "", dec = 1) => { const n = dgFin(v); return n == null ? "—" : fmtNum.format(Math.round(n * 10 ** dec) / 10 ** dec) + suf; };
const dgPct = (x) => { const n = dgFin(x); return n == null ? null : Math.round(n * 1000) / 10; };   // frazione → %
const dgDelta = (arr, n) => {   // variazione % ultimo vs n passi indietro (serie di numeri)
  if (!Array.isArray(arr) || arr.length < n + 1) return null;
  const a = dgFin(arr[arr.length - 1 - n]), b = dgFin(arr[arr.length - 1]);
  return (a && b) ? (b / a - 1) * 100 : null;
};
/* RENDIMENTO DEL BOOK cash-flow-neutral su ~daysBack giorni, dai delta di gain_pct del
   metrics_history: (1+g_ora)/(1+g_prima)−1. È l'UNICO rendimento onesto del portafoglio —
   i delta di eur_value sono inquinati (a) dal break di definizione cassa-inclusa→esclusa di
   metà luglio 2026 e (b), sempre, da versamenti/prelievi di liquidità. Lookback per DATA (per
   allinearsi alle finestre degli indici); fallback per conteggio rilevazioni se le date mancano. */
function bookReturnPct(mh, daysBack) {
  const gps = (mh || []).map(x => ({ d: x && x.date, g: dgFin(x && x.gain_pct) })).filter(x => x.g != null);
  if (gps.length < 2) return null;
  const last = gps[gps.length - 1];
  let prev;
  if (last.d) {
    const target = new Date(last.d).getTime() - daysBack * 86400000;
    prev = gps.reduce((best, e) => (e.d && Math.abs(new Date(e.d).getTime() - target) < Math.abs(new Date(best.d).getTime() - target)) ? e : best, gps[0]);
  } else {
    prev = gps[Math.max(0, gps.length - 1 - daysBack)];
  }
  if (!prev || prev === last || prev.g == null) return null;
  return ((1 + last.g / 100) / (1 + prev.g / 100) - 1) * 100;
}
const dgPercentile = (arr, v) => {   // posizione % di v nel range della serie
  const xs = (arr || []).map(dgFin).filter(x => x != null);
  const x = dgFin(v);
  if (x == null || xs.length < 5) return null;
  const lo = Math.min(...xs), hi = Math.max(...xs);
  return hi > lo ? Math.round((x - lo) / (hi - lo) * 100) : null;
};

/* ---------- fondamentale PROFONDO: CAGR pluriennale dai bilanci già in pipeline ---------- */
function titleDeepData(r) {
  const s = r.stats || {};
  const fin = Array.isArray(r.financials) ? [...r.financials].sort((a, b) => a.year - b.year) : [];
  let revCagr = null, niCagr = null, span = null;
  if (fin.length >= 2) {
    const a = fin[0], b = fin[fin.length - 1];
    span = b.year - a.year;
    const cagr = (x, y) => (x > 0 && y > 0 && span > 0) ? (Math.pow(y / x, 1 / span) - 1) : null;
    revCagr = cagr(a.revenue, b.revenue);
    niCagr = cagr(a.net_income, b.net_income);        // utili: solo se entrambi positivi (cagr lo garantisce)
  }
  const epsG = (s.eps_ttm > 0 && s.eps_forward > 0) ? s.eps_forward / s.eps_ttm - 1 : null;
  // efficienza pluriennale: divergenza CAGR utili − CAGR ricavi = leva operativa (se >0) o
  // erosione margini (se <0). Altman Z'' = distanza dal distress (variante non-manifatturieri).
  const effGap = (revCagr != null && niCagr != null) ? dgPct(niCagr - revCagr) : null;
  return { tk: r.ticker, span, revCagr: dgPct(revCagr), niCagr: dgPct(niCagr),
           revYoY: dgPct(s.revenue_growth), epsG: dgPct(epsG), effGap,
           altman: dgFin(s.altman_z), fwdPe: dgFin(s.forward_pe), peg: dgFin(s.peg),
           upside: dgPct((s.target_mean > 0 && r.price > 0) ? s.target_mean / r.price - 1 : null) };
}

/* ---------- DIGEST STORICI: le serie che i popup disegnano, tradotte in numeri ----------
   Un analista guarda le TRAIETTORIE (pendenza, percentile nel range, inversioni), non i livelli:
   questi digest danno all'AI esattamente ciò che l'occhio estrae dai grafici. Ogni voce è
   null-safe: serie assente → "—", mai un crash o un placeholder sporco. */
function buildHistoricalDigests() {
  const m = DATA.macro || {};
  const out = [];

  /* ⚠ v252 — MARGIN DEBT TOLTO ANCHE DAI DIGEST STORICI. In v249 l'avevo tolto dal QUADRO
     MACRO, ma `buildCIOText()` appende i digest e il dato rientrava da lì: il pacchetto che il
     CEO incolla lo conteneva ancora. È la classe "due implementazioni della stessa cosa"
     (v161, v207), trovata solo eseguendo il payload su me stesso invece di rileggere il codice.
     La motivazione resta quella del v249: dato onesto ma lento (68 giorni), presentato come
     stato attuale. Resta in dashboard con la sua data. */
  const cr = m.credit || {};
  const crh = Array.isArray(cr.history) ? cr.history.map(x => dgFin(x && x.v)).filter(x => x != null) : [];
  const crPct = dgPercentile(crh, cr.spread_hy);
  out.push({ label: "HY OAS (spread high yield, serie 1A)", text: crh.length >= 5
    ? `${dgTxt(cr.spread_hy, "%", 2)} · Δ1M ${signTxt(dgDelta(crh, 21), "%")} · range 1A [${dgTxt(Math.min(...crh), "", 2)}–${dgTxt(Math.max(...crh), "", 2)}] · percentile ${dgTxt(crPct, "°", 0)}${crPct != null && crPct <= 20 ? " (compressione estrema: il credito non prezza rischio)" : crPct != null && crPct >= 80 ? " (stress creditizio in costruzione)" : ""}`
    : "—" });

  const cvh = Array.isArray(m.curve_history) ? m.curve_history.map(x => dgFin(x && x.v)).filter(x => x != null) : [];
  let inv = null;
  for (let i = cvh.length - 1; i >= 0; i--) { if (cvh[i] < 0) { inv = cvh.length - 1 - i; break; } }
  out.push({ label: "Curva 10A–2A (serie ~2A)", text: cvh.length >= 5
    ? `${dgTxt(cvh[cvh.length - 1], "pp", 2)} · Δ1M ${cvh.length >= 22 ? dgTxt(cvh[cvh.length - 1] - cvh[cvh.length - 22], "pp", 2) : "—"} · Δ3M ${cvh.length >= 64 ? dgTxt(cvh[cvh.length - 1] - cvh[cvh.length - 64], "pp", 2) : "—"} · ${inv == null ? "nessuna inversione nella serie" : inv === 0 ? "INVERTITA ORA" : `ultima inversione ${inv} sedute fa${inv <= 252 ? " (il rischio recessivo storicamente matura DOPO la dis-inversione)" : ""}`}`
    : "—" });

  const vx = m.vix || {};
  const vxs = Array.isArray(vx.spark) ? vx.spark.map(dgFin).filter(x => x != null) : [];
  const vxPct = dgPercentile(vxs, vx.value);
  out.push({ label: "VIX (finestra spark ~3M)", text: dgFin(vx.value) != null
    ? `${dgTxt(vx.value, "", 1)} · oggi ${signTxt(dgFin(vx.change_pct))} · percentile finestra ${dgTxt(vxPct, "°", 0)} · term VIX/VIX3M ${dgTxt((m.smart_money || {}).vix_term_ratio, "", 2)}${dgFin((m.smart_money || {}).vix_term_ratio) != null ? ((m.smart_money || {}).vix_term_ratio >= 1 ? " (BACKWARDATION: stress)" : " (contango: calma)") : ""}`
    : "—" });

  const mh = Array.isArray(DATA.metrics_history) ? DATA.metrics_history : [];
  const navs = mh.map(x => dgFin(x && x.eur_value)).filter(x => x != null);
  const shp = mh.map(x => dgFin(x && x.sharpe)).filter(x => x != null);
  out.push({ label: `Controvalore investito & Sharpe del fondo (storico ${mh.length} rilevazioni)`, text: navs.length >= 2
    ? `investito €${fmtNum.format(Math.round(navs[navs.length - 1]))} (MTM, cassa esclusa) · Δ~7g ${signTxt(bookReturnPct(mh, 7))} (rendimento del book cash-neutral, non delta di eur_value) · Sharpe ${dgTxt(shp[shp.length - 1], "", 2)} (Δ7 ${shp.length >= 8 ? dgTxt(shp[shp.length - 1] - shp[shp.length - 8], "", 2) : "—"})`
    : "—" });

  return out;
}

/* CINEMATICA per-titolo (v131): derivate reali da metrics_history. I titles per-titolo esistono
   dai run dell'11/07 → il lookback dev'essere TITOLATO (nearest snapshot con dati per quel ticker),
   altrimenti cade prima che i titles esistano e la derivata risulta "vuota" (bug del placeholder). */
function titleKinematics(tk) {
  const titled = (DATA.metrics_history || []).filter(s => s && s.titles && s.titles[tk]);
  if (titled.length < 2) return { drs7: null, drs30: null, dmcr7: null, mcr: titled[0] ? dgFin(titled[0].titles[tk].mcr) : null, span: titled.length };
  const cur = titled[titled.length - 1].titles[tk];
  const back = (days) => { const target = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    let best = null; for (const s of titled) if (s.date <= target) best = s; return best; };
  const b7 = back(7) || titled[0];                 // <7g di storico → il più vecchio titolato (finestra reale <7g)
  const b30 = back(30);
  const d = (a, b) => (dgFin(a) != null && dgFin(b) != null) ? Math.round((a - b) * 10) / 10 : null;
  return {
    drs7: (b7 && b7 !== titled[titled.length - 1]) ? d(cur.rs, b7.titles[tk].rs) : null,
    drs30: (b30 && b30.titles[tk]) ? d(cur.rs, b30.titles[tk].rs) : null,
    dmcr7: (b7 && b7 !== titled[titled.length - 1]) ? d(cur.mcr, b7.titles[tk].mcr) : null,
    mcr: dgFin(cur.mcr), span: titled.length,
  };
}
/* percentile del prezzo nel range 52 settimane (da sparks.y1: dove sta OGGI tra minimo e massimo) */
function price52wPct(r) {
  const y1 = Array.isArray(r.sparks && r.sparks.y1) ? r.sparks.y1.map(dgFin).filter(x => x != null) : [];
  if (y1.length < 10 || !(r.price > 0)) return null;
  const lo = Math.min(r.price, ...y1), hi = Math.max(r.price, ...y1);
  return hi > lo ? Math.round((r.price - lo) / (hi - lo) * 100) : null;
}
/* trend multi-orizzonte + cinematica per titolo */
function sparkTrendRows() {
  const rows = [];
  for (const r of [...(DATA.portfolio || []), ...(DATA.watchlist || [])]) {
    if (!r || r.currency !== "USD" || !(r.price > 0)) continue;
    const sp = r.sparks || {};
    // ogni orizzonte richiede abbastanza barre da COPRIRLO davvero: su un titolo appena quotato
    // (es. SKHY) le serie sono troncate e 1S=1M=3M darebbero lo STESSO numero (falso multi-orizzonte).
    const tr = (k, minLen) => { const a = Array.isArray(sp[k]) ? sp[k].map(dgFin).filter(x => x != null) : [];
      return a.length >= minLen ? (a[a.length - 1] / a[0] - 1) * 100 : null; };
    const w1 = tr("w1", 4), m1 = tr("m1", 18), m3 = tr("m3", 50), y1 = tr("y1", 45);
    if ([w1, m1, m3, y1].every(v => v == null)) continue;
    const kin = titleKinematics(r.ticker);
    // REGIME DI VARIANZA per titolo: MCR che SALE (rischio che si concentra) mentre la RS SCENDE
    // (forza relativa che degrada) = cinematica in deterioramento PRIMA che il supporto ceda.
    // ⚠deg = degradazione cinematica REALE (MCR che sale + RS che decelera), non rumore. Prima
    // bastava drs7<0 e scattava su -0,3pp (META) — contraddicendo la soglia di rilevanza 3pp che
    // il payload dichiara altrove. Ora la decelerazione dev'essere RILEVANTE per la STESSA soglia:
    // un ⚠deg significa "entrambi i lati materiali", quindi affidabile come pre-allarme.
    const degrade = kin.dmcr7 != null && kin.dmcr7 > 0 && kin.drs7 != null && kin.drs7 <= -RS_VEL_RILEVANTE_PP;
    rows.push({ tk: r.ticker, w1, m1, m3, y1, held: !!r.qty,
                short: [w1, m1, m3, y1].filter(v => v != null).length < 2,
                pct52: price52wPct(r), ...kin, degrade });
  }
  return rows;
}

/* news mappate al singolo titolo attivo (100% dei titoli): usa i tag ticker già nel feed */
function activeTitleNews() {
  const news = DATA.news || [];
  const out = [];
  for (const r of [...(DATA.portfolio || []), ...(DATA.watchlist || [])]) {
    if (!r || r.currency !== "USD" || !(r.price > 0)) continue;
    const hits = news.filter(n => Array.isArray(n.tickers) && n.tickers.includes(r.ticker)).slice(0, 3);
    out.push({ tk: r.ticker, held: !!r.qty, hits });
  }
  return out;
}

/* EXECUTIVE BRIEF (v131): Δ dall'ultimo storico + priorità operativa — l'orientamento in cima
   che trasforma il dump in un brief. Solo INPUT per l'analisi, NON decisioni (quelle le prende Claude). */
function buildExecutiveDelta() {
  // v159 — a mercato CHIUSO "oggi" non esiste: i prezzi sono quelli dell'ultima seduta e il Δ dal run
  // precedente è ~0 per costruzione. Etichettare quei numeri "oggi" (e un Δ 0% come "non è cambiato
  // nulla") contraddiceva il blocco CATALIZZATORI NON PREZZATI, che nello stesso payload elenca
  // decine di novità. Il brief ora dichiara quale orologio sta leggendo.
  const closedNow = !usRegularSessionOpen();
  const dayLab = closedNow ? "ultima seduta" : "oggi";
  const L = [`=== EXECUTIVE BRIEF — Δ dall'ultimo storico + priorità ${closedNow ? "per la prossima apertura" : "di oggi"} (INPUT per l'analisi, non decisioni) ===`];
  const t = DATA.totals || {};
  const mh = (DATA.metrics_history || []).filter(x => x);
  // RENDIMENTI DEL BOOK cash-flow-neutral (da gain_pct), NON dai delta di eur_value: quella serie
  // ha un break di definizione (cassa inclusa→esclusa, metà lug 2026) + i movimenti di cassa la
  // inquinano → era la vera causa del paradosso "1S peggio di 1M" e del -8,35% sovrastimato.
  const gps = mh.map(x => ({ d: x.date, g: dgFin(x.gain_pct) })).filter(x => x.g != null);
  const dLast = gps.length >= 2 ? ((1 + gps[gps.length - 1].g / 100) / (1 + gps[gps.length - 2].g / 100) - 1) * 100 : null;
  const d7 = bookReturnPct(mh, 7);
  const fund1m = bookReturnPct(mh, 30);
  // "Investito" = capitale MTM cassa ESCLUSA (eur_invested), NON eur_value (che include la cassa):
  // prima la riga stampava il patrimonio TOTALE etichettato "Investito" e ci appiccicava delta
  // calcolati sulla serie invested → doppio disallineamento.
  const invested = Number.isFinite(t.eur_invested) ? t.eur_invested : (t.eur_value != null ? t.eur_value - (cashEur || 0) : null);
  // Δ dal run precedente: a mercati chiusi è ~0 PER COSTRUZIONE (stessi prezzi) — dirlo, altrimenti
  // "0%" si legge come "niente di nuovo" proprio mentre arrivano notizie non ancora prezzate.
  // v186: la guardia scattava solo se il delta era GIA' ~0, cioe' proprio quando non serviva.
  // A mercati chiusi un delta NON nullo e' l'anomalia da spiegare: non e' un movimento di
  // prezzo (i prezzi sono fermi), e' l'arrivo progressivo delle barre di chiusura per titoli
  // diversi. Presentarlo come "-0,41%" invitava a leggerlo come una perdita del weekend.
  // seduta a cui e' prezzato il book ADESSO: e' l'unico elemento verificabile che si puo'
  // offrire al lettore per capire da solo se lo scarto e' spiegato dalle barre.
  const dateBook = [...new Set((DATA.portfolio || []).filter(r => r.qty && r.currency !== "EUR" && r.price_asof).map(r => r.price_asof))].sort();
  const sedutaOra = dateBook.length === 1
    ? ` — ora il book è prezzato tutto alla chiusura del ${new Date(dateBook[0] + "T00:00:00").toLocaleDateString("it-IT").slice(0, 5)}`
    : dateBook.length > 1 ? ` — ora il book è prezzato su ${dateBook.length} sedute diverse (vedi l'avviso sopra)` : "";
  const dLastTxt = !closedNow ? `Δ ultimo run ${signTxt(dLast)}`
    : (dLast != null && Math.abs(dLast) >= 0.05)
      // v189 — PRIMA QUESTA RIGA ASSERIVA LA CAUSA, e il sistema non la conosce.
      // Il v186 diceva "questo scarto viene dall'arrivo della barra di chiusura": in quel caso
      // era vero, ma il testo valeva per QUALUNQUE delta non nullo a mercati chiusi. Se domani
      // lo scarto nascesse da una modifica delle posizioni, il payload dichiarerebbe con
      // sicurezza una causa falsa — e una spiegazione sbagliata detta con certezza è peggio di
      // nessuna spiegazione. Ora afferma solo ciò che SA (non è un movimento di prezzo, perché
      // le borse sono chiuse) ed elenca le cause possibili senza sceglierne una. L'unico dato
      // verificabile che può aggiungere lo aggiunge: a quale seduta è prezzato il book adesso.
      ? `Δ ultimo run ${signTxt(dLast)} — NON è un movimento di mercato (a borse chiuse i prezzi sono fermi): nasce dall'aggiornamento dei DATI fra i due run. Le cause possibili sono l'arrivo della barra di chiusura per titoli che prima erano fermi alla seduta precedente, oppure una modifica delle posizioni; il sistema non distingue quale delle due, quindi non lo afferma${sedutaOra}`
      : `Δ ultimo run ~0% (mercati CHIUSI: prezzi identici per costruzione — il nuovo di questo run NON è nei prezzi, è nelle notizie post-chiusura)`;
  L.push(`· Investito €${invested != null ? fmtNum.format(Math.round(invested)) : "—"} (MTM, cassa esclusa · ${dLastTxt}, Δ~7g ${signTxt(d7)} — rendimento del book cash-neutral) · Sharpe ${dgTxt(t.portfolio_sharpe_ratio, "", 2)} · VIX ${dgTxt((DATA.macro || {}).vix && DATA.macro.vix.value, "", 1)} · cassa ${fmtEUR.format(Math.round(cashEur || 0))} · budget op. ${t.budget_operativo_spendibile != null ? fmtEUR.format(Math.round(t.budget_operativo_spendibile)) : "—"}`);
  // BENCHMARK: UN SOLO indice su tutte le finestre — Nasdaq 100 (il mandato, memory "vs NDX"),
  // via QQQ, l'unica serie NDX-family con spark w1/m1. Prima mescolava NDX (giorno) e Nasdaq
  // COMPOSITE (settimana/mese): indici DIVERSI, alpha non confrontabili tra finestre.
  const qqq = (DATA.top_etfs || []).find(r => r.ticker === "QQQ");
  const ndxTr = (k) => { const a = ((qqq || {}).sparks || {})[k] || []; const xs = a.map(dgFin).filter(x => x != null);
    return xs.length >= 2 ? (xs[xs.length - 1] / xs[0] - 1) * 100 : null; };
  const bm = (DATA.macro || {}).benchmarks || {};
  const ndxDay = (qqq && qqq.change_pct != null) ? qqq.change_pct : dgFin(bm.ndx);
  const pday = typeof portfolioDayPct === "function" ? portfolioDayPct() : null;
  const alphaDay = (pday != null && ndxDay != null) ? Math.round((pday - ndxDay) * 100) / 100 : null;
  // v174 — ALPHA SU BASE COMPARABILE. Le finestre 1S/1M usano gain_pct = rendimento del BOOK
  // INTERO in EUR (BTP ~15% a volatilità nulla incluso, cambio incluso) confrontato con un indice
  // AZIONARIO in USD: grandezze non omogenee, e lo scarto è materiale in entrambe le direzioni
  // (sul run del 26/07: l'alpha 1M passava da ≈0 a -2,9pp una volta reso comparabile).
  // Qui si ricostruisce il rendimento del solo comparto AZIONARIO in USD dalle serie prezzi,
  // pesato coi controvalori CORRENTI — assunzione dichiarata: se hai movimentato molto nella
  // finestra, i pesi di oggi non sono quelli di allora.
  const alphaEquity = (n) => {
    const bench = ((DATA.watchlist || []).find(x => x.ticker === "^IXIC")
      || (DATA.top_etfs || []).find(x => x.ticker === "QQQ") || {});
    const bs = ((bench.sparks || {}).m6 || []).map(dgFin).filter(x => x != null);
    if (bs.length <= n) return null;
    const rendi = (a) => { const i = a.length - 1 - n; return i >= 0 ? a[a.length - 1] / a[i] - 1 : null; };
    let num = 0, den = 0;
    for (const r of (DATA.portfolio || [])) {
      if (!r || r.currency !== "USD" || !(r.qty > 0)) continue;
      const ss = ((r.sparks || {}).m6 || []).map(dgFin).filter(x => x != null);
      const x = ss.length > n ? rendi(ss) : null;
      if (x == null) continue;
      const v = r.qty * r.price;
      num += v * x; den += v;
    }
    const bm = rendi(bs);
    if (!den || bm == null) return null;
    return { ptf: num / den * 100, bm: bm * 100, alpha: (num / den - bm) * 100 };
  };
  const a1s = alphaEquity(5), a1m = alphaEquity(22);
  const alphaOmogeneoPresente = !!(a1s || a1m);
  if (a1s || a1m) {
    L.push(`· ALPHA DEL PROCESSO (base OMOGENEA: solo comparto AZIONARIO in USD vs Nasdaq Composite, entrambi prezzi — niente BTP, niente cambio; ricostruito dalle serie prezzi ai controvalori CORRENTI, quindi approssimato se hai movimentato molto nella finestra): ${[
      a1s ? `~1S azionario ${signTxt(Math.round(a1s.ptf * 100) / 100)} vs indice ${signTxt(Math.round(a1s.bm * 100) / 100)} → alpha ${signTxt(Math.round(a1s.alpha * 100) / 100, "pp")}` : null,
      a1m ? `~1M azionario ${signTxt(Math.round(a1m.ptf * 100) / 100)} vs indice ${signTxt(Math.round(a1m.bm * 100) / 100)} → alpha ${signTxt(Math.round(a1m.alpha * 100) / 100, "pp")}` : null,
    ].filter(Boolean).join(" · ")}. È QUESTO il verdetto sulla SELEZIONE dei titoli, ed è l'UNICO alpha del payload calcolato su basi omogenee (stesso comparto, stessa valuta, stesso tipo di prezzo). La riga BENCHMARK qui sotto misura un'altra cosa — il patrimonio intero, BTP e cambio compresi — e quando i due segni non coincidono NON è una contraddizione da risolvere: è la differenza fra 'ho scelto bene i titoli' e 'il mio patrimonio è cresciuto'.`);
  }
  L.push(`· BENCHMARK vs Nasdaq 100 (il mandato, proxy QQQ): ${dayLab} fondo ${signTxt(pday)} vs NDX ${signTxt(ndxDay)}${alphaDay != null ? ` (alpha ${signTxt(alphaDay, "pp")})` : ""} · ~1S fondo ${signTxt(d7)} vs NDX ${signTxt(ndxTr("w1"))} · ~1M fondo ${signTxt(fund1m)} vs NDX ${signTxt(ndxTr("m1"))} (⚠ BASI DIVERSE, non confrontare i tre alpha fra loro: "${dayLab}" è il solo comparto AZIONARIO in USD (BTP e cambio esclusi), mentre 1S e 1M sono il rendimento del book INTERO in EUR — quindi includono il BTP (~15% del book, volatilità ~0, che comprime meccanicamente il rendimento di periodo) e l'effetto cambio su un NAV per il 76% in USD non coperto. Il confronto col NDX, indice azionario in USD, è quindi indicativo sulle finestre lunghe: ${alphaOmogeneoPresente ? "⚠ questa riga NON è il verdetto sul processo — quello è la prima riga del brief, l'unica calcolata su base omogenea. Qui il SEGNO può dipendere dal BTP e dall'EUR/USD prima che dalla selezione dei titoli, quindi usala per il patrimonio, non per giudicare le scelte" : "⚠ in questo snapshot NON esiste un alpha su base omogenea (serie insufficienti), quindi questa riga è l'unica disponibile: leggila sapendo che il suo SEGNO può dipendere dal BTP e dall'EUR/USD prima che dalla selezione dei titoli"}. Finestre approssimate anche nel tempo: rilevazioni fondo vs sedute indice)`);
  const v = decisionVerdict();
  // v179 — il VERDETTO non apre piu il payload. Era un DUPLICATO: la stessa etichetta compare
  // sotto in OUTPUT DEL MOTORE, li' pero' accompagnata dai criteri e dai veti che la giustificano.
  // In cima, spogliata del ragionamento e con uno score a due cifre che il backtest non ha
  // validato, faceva una cosa sola: ANCORARE su una conclusione prima di aver visto un solo dato.
  // Entrambe le risposte LLM reali si sono strutturate attorno all'accettare o rifiutare quel
  // verdetto: il payload decideva l'agenda del report. Restano i FATTI che impongono una
  // decisione; il giudizio del motore si legge dove e' argomentato.
  if ((v.withPlan || []).length) {
    /* ⚠ v228 — ORDINARE E' GIA' UN GIUDIZIO (la ragione per cui v200 ha tolto la classifica).
       La classifica era stata rimossa dal blocco FILTRI, che infatti dichiara "in ordine
       alfabetico … questo blocco non classifica piu'" — ma l'ordine per punteggio era
       SOPRAVVISSUTO qui e nel blocco dei livelli, che elencavano "GOOGL, AVGO, MSFT, AMZN, WDC"
       mentre i FILTRI dicevano "AMZN, AVGO, GOOGL, MSFT, WDC". Stessa lista, due ordini: uno dei
       due comunicava una preferenza che il sistema dichiara di non esprimere piu'. */
    const nomi = v.withPlan.map(p => p.r.ticker).sort((a, b) => a.localeCompare(b));
    L.push(`· Titoli che superano i filtri quantitativi (${nomi.length}, in ordine alfabetico): ${nomi.slice(0, 6).join(", ")}${nomi.length > 6 ? ", …" : ""} — soglie e veti nel blocco FILTRI QUANTITATIVI. Non è una classifica e non è una raccomandazione: è l'elenco di chi passa.`);
  }
  // PRIORITÀ = solo eventi che impongono una decisione (fatti databili). Il veto in portafoglio
  // e' stato tolto: e' un GIUDIZIO del motore, non un evento, e vive gia' nel blocco motore.
  const pri = [];
  if (t.budget_operativo_spendibile != null && Math.round(t.budget_operativo_spendibile) <= 0)
    pri.push(`⛔ BUDGET 0 — nessun acquisto eseguibile (ignora cassa/budget di run precedenti, A1)`);
  const sh = (DATA.macro || {}).shock_alert;
  if (sh && sh.active) pri.push(`🚨 SHOCK ${(sh.sources || []).map(s => `${s.src} ${signTxt(s.chg)}`).join("/")}`);
  const sv = (v.stopViolations || []).map(x => x.r.ticker);
  if (sv.length) pri.push(`⛔ stop violati: ${sv.join(", ")}`);
  // stessa funzione della tabella: oggi = 0 giorni, e OGGI e' il caso piu' urgente, non il meno
  const earn = (DATA.portfolio || []).filter(r => {
    const g = giorniAllaTrimestrale(r.earnings_date); return r.qty && g != null && g >= 0 && g <= 7;
  }).map(r => ({ tk: r.ticker, g: giorniAllaTrimestrale(r.earnings_date) }))
    .sort((x, y) => x.g - y.g)                       // OGGI prima di domani: e' una riga di priorita'
    .map(x => x.g === 0 ? `${x.tk} (OGGI)` : `${x.tk} (${x.g}g)`);
  if (earn.length) pri.push(`📅 earnings ≤7g: ${earn.join(", ")}`);
  const movers = sparkTrendRows().filter(r => r.drs7 != null).sort((a, b) => b.drs7 - a.drs7);
  if (movers.length) pri.push(`RS Δ7g → top ${movers[0].tk} ${signTxt(movers[0].drs7, "pp")} / worst ${movers[movers.length - 1].tk} ${signTxt(movers[movers.length - 1].drs7, "pp")}`);
  const degr = sparkTrendRows().filter(r => r.degrade).map(r => r.tk);
  if (degr.length) pri.push(`⚠ cinematica in degrado (MCR↑ + RS↓): ${degr.join(", ")}`);
  L.push("· PRIORITÀ: " + (pri.length ? pri.join(" · ") : "nessun evento forcing rilevato"));
  return L.join("\n");
}

/* ---------- testo per l'analisi AI: executive brief + prompt esistente + digest storici ---------- */
function historicalDigestText() {
  const L = [];
  L.push("=== ANALISI STORICA — LETTURA QUANTITATIVA DEI GRAFICI (traiettorie delle serie: usa pendenze e percentili, non solo i livelli) ===");
  for (const d of buildHistoricalDigests()) L.push(`· ${d.label}: ${d.text}`);

  const tr = sparkTrendRows();
  if (tr.length) {
    const top3 = tr.filter(r => r.held && r.mcr != null).sort((a, b) => b.mcr - a.mcr).slice(0, 3);
    const top3sum = top3.reduce((s, r) => s + (r.mcr || 0), 0);
    L.push(`CINEMATICA & TREND PER TITOLO — ${tr.length} TITOLI → ${tr.length} righe (variazione % nel range · Perc.52S = posizione del prezzo nel range 52 settimane · ΔRS = velocità della forza relativa vs NDX · ΔMCR = accelerazione della concentrazione del rischio · ⚠deg = MCR↑ con RS↓, cinematica in degrado PRIMA della rottura del supporto):`);
    L.push("| Titolo | 1S | 1M | 3M | 1A | Perc.52S | ΔRS 7g | ΔRS 30g | ΔMCR 7g |");
    L.push("|---|---|---|---|---|---|---|---|---|");
    for (const r of tr) L.push(`| ${r.tk}${r.held ? " [ptf]" : ""}${r.degrade ? " ⚠deg" : ""}${r.short ? " [storia insuff.]" : ""} | ${signTxt(r.w1)} | ${signTxt(r.m1)} | ${signTxt(r.m3)} | ${signTxt(r.y1)} | ${dgTxt(r.pct52, "°", 0)} | ${r.drs7 != null ? signTxt(r.drs7, "pp") : "—"} | ${r.drs30 != null ? signTxt(r.drs30, "pp") : "— (storico <30g)"} | ${r.dmcr7 != null ? signTxt(r.dmcr7, "pp") : "—"} |`);
    // REGIME DI VARIANZA a livello di portafoglio: concentrazione top-3 vs qualità (Sharpe) in trend
    const shp = (DATA.metrics_history || []).map(x => dgFin(x && x.sharpe)).filter(x => x != null);
    const dShp = shp.length >= 8 ? Math.round((shp[shp.length - 1] - shp[shp.length - 8]) * 100) / 100 : null;
    if (top3.length) L.push(`REGIME DI VARIANZA: MCR Top-3 ${dgTxt(top3sum, "%", 0)} (${top3.map(r => r.tk).join("+")}) su Sharpe ptf ${dgTxt((DATA.totals || {}).portfolio_sharpe_ratio, "", 2)}${dShp != null ? ` (Δ7 ${signTxt(dShp, "")})` : ""} → concentrazione alta + qualità ${dShp != null && dShp < 0 ? "in deterioramento = fragilità della varianza (il rischio si addensa mentre il rendimento/rischio cala)" : "stabile"}.`);
  }

  const news = activeTitleNews();
  const withNews = news.filter(n => n.hits.length);
  if (news.length) {
    // NB: lista, non tabella "| " → dicitura SENZA "— N TITOLI" per non innescare l'invariante I4 (righe=conteggio)
    // Anti-bloat v145: elenco SOLO i titoli con news; i restanti in UNA riga (ticker + Deduzione Zero),
    // invece di ~20 righe "TICKER: —" a segnale zero. L'istruzione Deduzione Zero resta esplicita.
    const noNews = news.filter(n => !n.hits.length);
    L.push(`NEWS VERTICALE PER TITOLO ATTIVO (${withNews.length}/${news.length} titoli attivi con news oggi · catalizzatori/rischi specifici):`);
    for (const n of withNews) {
      L.push(`  ${n.tk}${n.held ? " [ptf]" : ""}: ${n.hits.map(h => `[${(h.sentiment || "neu").slice(0, 3)}] ${h.title_it || h.title}`).join(" · ")}`);
    }
    if (noNews.length) L.push(`  Altri ${noNews.length} titoli attivi (${noNews.map(n => `${n.tk}${n.held ? " [ptf]" : ""}`).join(", ")}): nessuna news verticale oggi.`);
  }

  const deep = [...(DATA.portfolio || []), ...(DATA.watchlist || [])]
    .filter(r => r && r.currency === "USD" && r.price > 0 && !/^[\^]/.test(r.ticker) && !/[=]F$|-USD$/.test(r.ticker))
    .map(titleDeepData);
  if (deep.length) {
    // SOLO le colonne NUOVE non già in Tabella A/B (CAGR pluriennale + EPS ttm→fwd): PEG, crescita
    // YoY, Fwd P/E e upside sono già nella tabella fondamentale e in Tabella A/B → tolte (anti-ridondanza).
    L.push(`=== FONDAMENTALE PROFONDO — ${deep.length} TITOLI → ${deep.length} righe (efficienza PLURIENNALE — ciò che le tabelle YoY NON mostrano; EPS impl. = eps_forward/eps_ttm−1; Δeff = CAGR utili − CAGR ricavi, >0 = leva operativa / <0 = erosione margini. NB: l'Altman Z'' NON è ripetuto qui — è un dato puntuale, non pluriennale, e vive nella tabella ANALISI FONDAMENTALE con la sua metodologia e il flag [RISCHIO DEFAULT]) ===`);
    L.push("| Titolo | CAGR ricavi | CAGR utili | Δeff (utili−ricavi) | EPS ttm→fwd |");
    L.push("|---|---|---|---|---|");
    for (const t of deep) L.push(`| ${t.tk} | ${dgTxt(t.revCagr, "%")}${t.span ? ` (${t.span}A)` : ""} | ${dgTxt(t.niCagr, "%")} | ${dgTxt(t.effGap, "pp")} | ${dgTxt(t.epsG, "%")} |`);
  }
  L.push("USO METODOLOGICO: il CAGR pluriennale e il YoY delle tabelle misurano cose diverse — un YoY gonfiato da un punto basso del ciclo (es. rimbalzo delle memorie) può convivere con un CAGR piatto, e in quel caso la crescita è ciclica, non strutturale. Sulle serie macro, sia i valori ESTREMI (HY OAS ai minimi del range, VIX ai minimi della sua distribuzione) sia le INVERSIONI DI TENDENZA (spread in allargamento, curva in dis-inversione) sono i due modi in cui questi indicatori hanno storicamente anticipato i punti di svolta.");
  return L.join("\n");
}
/* ═══════════════════ MOTORE DI CORRELAZIONE (v154) ═══════════════════
   Il problema che risolve: il payload consegnava news, settori e posizioni in SILOS separati,
   lasciando all'LLM tutto il lavoro di join su ~65k caratteri. Risultato: non lo faceva, e
   ripiegava sul riassunto del verdetto del motore (risposte "banali e meccaniche").
   Qui il join lo fa il CODICE — deterministico, verificabile — così l'LLM riceve il segnale
   GIÀ COLLEGATO al book e può spendere il suo budget in giudizio, non in aggregazione.
   NB: le news arrivano con tickers quasi sempre solo [MACRO] (build_keywords cerca il ticker
   letterale nel titolo): la classificazione TEMATICA qui sotto è ciò che le rende utilizzabili. */
/* Matcher per tema. ATTENZIONE ai falsi positivi (visti sul campo):
   - "AI" va cercato SOLO come acronimo MAIUSCOLO nel titolo inglese: in italiano "ai" è una
     preposizione comune e classificava news di previdenza sociale come AI/DATACENTER;
   - la geopolitica generica (guerra/Iran) NON va mappata sui semiconduttori: colpisce
     l'appetito al rischio (→ beta), mentre solo dazi/export-control toccano la filiera. */
/* CLASSIFICAZIONE AUTOMATICA (v155) — i temi NON hanno più liste di ticker da aggiornare a mano.
   Ogni titolo si auto-assegna dai PROPRI dati (sector, rs_bench, name, market cap): un nome nuovo
   aggiunto in watchlist entra nei temi DA SOLO, senza toccare il codice. Prima ogni ingresso
   (WDC/MRVL/NOW/BE…) restava invisibile al motore di correlazione finché non lo si aggiungeva a
   mano — e un rename del ticker (TSM→TSMC) lo faceva uscire in silenzio dal tema.
   Uniche eccezioni: i proxy SEMANTICI che i dati non possono esprimere (MSTR è "Technology" e
   CRCL "Financial Services", ma di fatto seguono il bitcoin) → THEME_SEED, additivo e dichiarato. */
const THEME_SEED = { CRYPTO: ["MSTR", "CRCL", "BTC-USD"] };
const thName = (r) => `${r.name || ""} ${r.ticker || ""}`;
const thIsSemi = (r) => r.rs_bench === "sox"
  || /semiconduc|semicondutt|foundry|micron|sandisk|western digital|hynix|taiwan semi|marvell|cerebras|super micro|broadcom|nvidia|intel|rigetti/i.test(thName(r))
  || /^(TSMC?|WDC|SNDK|MRVL|SMCI|CBRS|SKHY)$/i.test(r.ticker || "");
const thIsSoftware = (r) => r.sector === "Technology" && !thIsSemi(r);
const thIsEnergy = (r) => r.sector === "Utilities" || /nuclear|energy|reactor|power|solar/i.test(thName(r));
const thIsMegacapComm = (r) => r.sector === "Communication Services"
  && (dgFin((r.stats || {}).market_cap) ?? 0) >= 100e9;
const thIsOil = (r) => /petroli|greggio|crude|\boil\b|\bWTI\b/i.test(thName(r)) || /^CL=F$/.test(r.ticker || "");
const NEWS_THEMES = [
  { id: "SEMI/CHIP", sel: thIsSemi,
    m: (en, it) => /chip|semiconduc|foundry|wafer|\bdram\b|\bnand\b|\bhbm\b|\bgpu\b|nvidia|tsmc|micron/i.test(en) || /semicondutt|chip/i.test(it) },
  { id: "AI/DATACENTER", sel: (r) => thIsSemi(r) || thIsSoftware(r) || thIsMegacapComm(r),
    m: (en, it) => /\bAI\b/.test(en) || /artificial intelligence|data ?cent(er|re)|\bLLM\b|openai|inference/i.test(en) || /intelligenza artificiale|data ?center/i.test(it) },
  { id: "TASSI/FED/INFLAZIONE", sel: null,   // null = colpisce per MULTIPLO/BETA (il codice sceglie)
    // v162: "federal reserve" per esteso NON era coperto da \bfed\b — una news sulla riunione FOMC
    // a 4 giorni dall'evento restava fuori dal tema. Idem "rate cut/hike/decision" e l'IT "riunione della Fed".
    m: (en, it) => /\bfed\b|federal reserve|fomc|powell|interest rate|\brates?\b|rate (cut|hike|decision)|inflation|\bcpi\b|\bpce\b|yield|treasury|bond sell|hawkish|dovish/i.test(en) || /inflazion|tass[oi] d|rendiment|federal reserve|riunione della fed/i.test(it) },
  { id: "CLOUD/SOFTWARE", sel: thIsSoftware,
    m: (en, it) => /\bcloud\b|software|\bsaas\b|subscription/i.test(en) || /\bcloud\b|software/i.test(it) },
  { id: "CRYPTO", sel: (r) => /bitcoin|crypto|blockchain|stablecoin/i.test(thName(r)) || /-USD$/.test(r.ticker || ""),
    m: (en, it) => /bitcoin|crypto|ethereum|blockchain|stablecoin/i.test(en + " " + it) },
  { id: "ENERGIA/OIL", sel: thIsOil,
    m: (en, it) => /\boil\b|crude|opec|brent|\bwti\b|energy shock|natural gas/i.test(en) || /petroli|greggio|shock energetic/i.test(it) },
  { id: "NUCLEARE/UTILITY", sel: thIsEnergy,
    // v162: le sovvenzioni all'energia pulita toccano BE/CEG/OKLO in watchlist ma non matchavano nulla
    m: (en, it) => /nuclear|reactor|\bSMR\b|power grid|electricity demand|clean energy|renewable/i.test(en) || /nuclear|rete elettric|energia pulita|rinnovabil/i.test(it) },
  { id: "DAZI/EXPORT-CONTROL", sel: thIsSemi,   // SOLO filiera/supply chain
    // v162: "investigate EU trade practices" (escalation commerciale) non matchava "trade probe|trade war"
    m: (en, it) => /tariff|export control|trade prob|trade practice|trade investigation|trade war|chip ban|sanction.{0,20}(chip|tech|semicon)/i.test(en) || /dazi|controlli all.export|guerra commercial|pratiche commerciali|indagine commercial/i.test(it) },
  { id: "GEOPOLITICA (risk-off)", sel: null,   // appetito al rischio → colpisce i beta alti
    m: (en, it) => /\bwar\b|iran|hormuz|middle east|missile|airstrike|invasion/i.test(en) || /guerra|iran|medio oriente/i.test(it) },
  { id: "REGOLAM./MEGACAP", sel: thIsMegacapComm,
    m: (en, it) => /antitrust|\bEU fine|probe into tech|privacy fine|alphabet|\bgoogle\b|\bmeta\b/i.test(en) || /antitrust|multe dell.UE|aziende tecnolog/i.test(it) },
];
/* membri di un tema: predicato sui dati del titolo + eventuale seed semantico */
function themeMembers(th, universe) {
  const seed = THEME_SEED[th.id] || [];
  const out = new Map();
  for (const r of universe.values()) if (th.sel && th.sel(r)) out.set(r.ticker, r);
  for (const t of seed) { const r = universe.get(t); if (r) out.set(t, r); }
  return [...out.values()];
}
/* ultimo set di divergenze in forma strutturata (popolato da marketLinkText, letto dal CI) */
let LAST_DIV_SIGNALS = [];
function marketLinkText() {
  const L = [];
  const ptf = (DATA.portfolio || []).filter(isEquity);
  // universo dei temi: equity + le ANCORE tematiche non-equity della watchlist (petrolio, crypto:
  // servono a dare un bersaglio ai temi ENERGIA/CRYPTO). Gli INDICI (currency PTS o prefisso ^)
  // restano fuori: sono benchmark, non posizioni tematizzabili.
  const wl = (DATA.watchlist || []).filter(r => r && r.price > 0 && r.currency !== "PTS"
    && !/^\^/.test(r.ticker || "") && (isEquity(r) || /[-=]/.test(r.ticker || "")));
  const held = new Map(ptf.map(r => [r.ticker, r]));
  const universe = new Map([...ptf, ...wl].map(r => [r.ticker, r]));
  const wOf = (r) => positionWeightPct(r);
  const rsOf = (r) => dgFin(r.rs_ndx_1m ?? r.rs_1m);
  const mcrOf = (r) => dgFin(r.risk_contrib_pct);
  const tag = (r) => {
    const w = wOf(r), rs = rsOf(r), m = mcrOf(r);
    const bits = [];
    if (w != null) bits.push(`${fmtNum.format(w)}% NAV`);
    if (m != null) bits.push(`MCR ${fmtNum.format(m)}%`);
    if (rs != null) bits.push(`RS ${signTxt(rs, "pp")}`);
    return `${r.ticker}${held.has(r.ticker) ? "" : " [wl]"}${bits.length ? ` (${bits.join(" · ")})` : ""}`;
  };

  // ── 1) TEMI DELLE NEWS → POSIZIONI TOCCATE ────────────────────────────────
  const news = (DATA.news || []).filter(isRealNews);
  /* v161 — CODA EDITORIALE fuori dal matching. I titoli arrivano con la fonte in coda
     ("… - Reuters", "… - Kavout | AI"): il matcher /\bAI\b/ agganciava la SIGLA DELLA FONTE e
     classificava come AI/DATACENTER una notizia sul rapporto occupazione, che finiva pure a fare
     da titolo-esempio del tema più importante per questo book. Qui la coda si toglie prima del
     match: segmento finale dopo " - " o " | ", corto e senza punteggiatura di frase, max 2 giri. */
  const newsCore = (t) => {
    let s = String(t || "");
    for (let i = 0; i < 2; i++) {
      const m = s.match(/^(.*?)\s+[-|]\s+([^-|]{1,30})$/);
      if (!m || /[.!?;:]/.test(m[2])) break;
      s = m[1];
    }
    return s;
  };
  // OROLOGIO DEL PREZZO (v158): quali news il prezzo ha GIÀ votato e quali no. Serve sia al blocco
  // dei catalizzatori non prezzati sia a non dichiarare divergenze logicamente impossibili.
  const split = newsSplitByClose();
  const marketClosed = !usRegularSessionOpen();
  const unpricedSet = new Set(split.unpriced.map(n => n.title));
  const themed = [];
  for (const th of NEWS_THEMES) {
    const hits = news.filter(n => th.m(newsCore(n.title), newsCore(n.title_it)));
    if (!hits.length) continue;
    const nUnpriced = hits.filter(n => unpricedSet.has(n.title)).length;
    let targets;
    if (th.sel) targets = themeMembers(th, universe);
    else {   // temi TASSI/GEOPOLITICA: colpiscono chi paga multiplo/beta — i più sensibili del book
      targets = [...universe.values()]
        .filter(r => (dgFin(r.beta_ndx) ?? 0) >= 1.5 || (dgFin(r.pe) ?? 0) >= 60)
        .sort((a, b) => (dgFin(b.beta_ndx) ?? 0) - (dgFin(a.beta_ndx) ?? 0));
    }
    // le posizioni DETENUTE vanno prima e, fra queste, quelle che PESANO di più: la lista viene
    // troncata a 8 e il taglio deve cadere sui nomi meno rilevanti, non su quelli che capitano
    // ultimi nell'ordine di portafoglio (v163: ORCL, RS -23pp, veniva tagliato mentre restavano
    // nomi a peso minore).
    targets.sort((a, b) => (held.has(b.ticker) ? 1 : 0) - (held.has(a.ticker) ? 1 : 0)
      || (wOf(b) ?? 0) - (wOf(a) ?? 0));
    const inPtf = targets.filter(r => held.has(r.ticker));
    if (!targets.length) continue;
    const expo = inPtf.reduce((s, r) => s + (wOf(r) ?? 0), 0);
    // l'esemplare del tema: prima una news che nomina un titolo dell'universo (segnale specifico),
    // poi la più recente. hits[0] era l'ordine di arrivo del feed — arbitrario, e su AI/DATACENTER
    // metteva in vetrina un falso positivo invece della notizia che muove il book.
    // …ma il criterio dipende dal TIPO di tema: su un tema di titoli (SEMI, AI, CLOUD…) la news
    // che cita un ticker è la più informativa; su un tema MACRO (TASSI, GEOPOLITICA — quelli senza
    // predicato `sel`) citare un ticker non c'entra, e preferirlo metteva in vetrina un pezzo sul
    // Bitcoin come esemplare del tema Fed. Lì vince semplicemente la notizia più recente.
    // v163: il predicato guardava `universe`, che include per costruzione le ANCORE non-equity
    // (BTC-USD, CL=F). Una news che cita SOLO il Bitcoin vinceva così il rango di "segnale
    // specifico" sul tema DAZI (56% del NAV in semi), scavalcando per recency le notizie sulle
    // tariffe: il tema più pesante del book veniva presentato con un titolo sul Bitcoin. Il
    // predicato ora è relativo ai BERSAGLI DEL TEMA, non all'universo.
    const tset = new Set(targets.map(r => r.ticker));
    const ranked = hits.slice().sort((a, b) => {
      const sp = (x) => (th.sel && (x.tickers || []).some(t => tset.has(t))) ? 1 : 0;
      return sp(b) - sp(a) || String(b.published || "").localeCompare(String(a.published || ""));
    });
    const shownT = targets.slice(0, 8);
    // `allTargets` = elenco COMPLETO: i detector di divergenza devono girare su questo, non sulla
    // lista troncata per la stampa (altrimenti un nome tagliato non può generare segnale).
    themed.push({ id: th.id, n: hits.length, nUnpriced, th, sample: newsCore(ranked[0].title_it || ranked[0].title).slice(0, 110),
                  targets: shownT, allTargets: targets, expo,
                  expoShown: shownT.filter(r => held.has(r.ticker)).reduce((s, r) => s + (wOf(r) ?? 0), 0),
                  hiddenPtf: inPtf.length - shownT.filter(r => held.has(r.ticker)).length,
                  inPtf: inPtf.length });
  }
  themed.sort((a, b) => b.expo - a.expo || b.n - a.n);
  if (themed.length) {
    // v161 — ANTI-RIPETIZIONE: gli stessi titoli ricorrono in quasi tutti i temi, e stampare per
    // ognuno "(peso NAV · MCR · RS)" ogni volta significava ripetere ~40 volte gli stessi numeri:
    // 2-3k caratteri che DILUISCONO il segnale invece di aggiungerlo. Il tag completo si stampa
    // alla PRIMA comparsa del titolo (dove informa davvero), poi basta il ticker.
    const tagged = new Set();
    const tagOnce = (r) => {
      if (tagged.has(r.ticker)) return `${r.ticker}${held.has(r.ticker) ? "" : " [wl]"}`;
      tagged.add(r.ticker); return tag(r);
    };
    L.push("· TEMI DELLE NEWS DI OGGI → LE TUE POSIZIONI ESPOSTE (il collegamento news↔book, che i ticker delle news NON danno · peso NAV/MCR/RS indicati alla prima comparsa di ogni titolo):");
    for (const t of themed) {
      const unp = (marketClosed && t.nUnpriced) ? ` · ⏰ ${t.nUnpriced}/${t.n} NON ancora prezzate` : "";
      // v163: la % dichiarata è calcolata su TUTTI i detenuti del tema ma se ne stampano max 8 →
      // la somma dei nomi visibili non tornava e il CIO trovava un dato che non quadra. Il resto
      // ora è dichiarato esplicitamente invece di sparire in silenzio.
      const extra = t.hiddenPtf > 0
        ? ` (+${t.hiddenPtf} detenute non elencate: ${fmtNum.format(Math.round((t.expo - t.expoShown) * 10) / 10)}% del NAV)` : "";
      L.push(`  [${t.id}] ${t.n} news${unp} · es. "${t.sample}" → ${t.targets.map(tagOnce).join(" · ")}${extra}${t.inPtf ? ` — esposizione in PTF ${fmtNum.format(Math.round(t.expo * 10) / 10)}% del NAV` : " — nessuna posizione detenuta (solo watchlist)"}`);
    }
  }

  // ── 1-bis) CATALIZZATORI NON ANCORA PREZZATI (v158) ───────────────────────
  // A mercato chiuso il prezzo è congelato alla campana: le news arrivate dopo NON sono nel prezzo.
  // Sono le uniche che possono muovere la PROSSIMA apertura — e il payload prima non le distingueva
  // dalle news già digerite, seppellendo un catalizzatore su misura del book in mezzo alle altre.
  if (marketClosed && split.unpriced.length && split.close) {
    const dt = split.close.at;
    const dd = `${String(dt.getUTCDate()).padStart(2, "0")}/${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
    // ogni news non prezzata → titoli toccati: prima i ticker espliciti della news, poi i temi
    const rows = [];
    const cut = (s, n) => { const x = String(s); if (x.length <= n) return x; const c = x.slice(0, n); const sp = c.lastIndexOf(" "); return (sp > n * 0.6 ? c.slice(0, sp) : c) + "…"; };
    for (const n of split.unpriced) {
      const en = newsCore(n.title), it = newsCore(n.title_it);
      // una news che CITA il ticker vale molto più di un macro-tema che si sventaglia su mezzo book:
      // la specificità è il criterio di ordinamento, non la sola esposizione.
      const direct = (n.tickers || []).map(t => universe.get(t)).filter(r => r && held.has(r.ticker));
      const ths = NEWS_THEMES.filter(t => t.m(en, it) && t.sel);
      const viaTheme = ths.flatMap(t => themeMembers(t, held));
      const hit = [...new Map([...direct, ...viaTheme].map(r => [r.ticker, r])).values()]
        .filter(r => held.has(r.ticker))
        .sort((a, b) => (direct.includes(b) ? 1 : 0) - (direct.includes(a) ? 1 : 0) || (wOf(b) ?? 0) - (wOf(a) ?? 0));
      if (!hit.length) continue;                         // solo ciò che tocca il book: niente rumore macro
      const expo = hit.reduce((s, r) => s + (wOf(r) ?? 0), 0);
      const when = n.published ? new Date(n.published) : null;
      const hhmm = when && !isNaN(when) ? `${String(when.getUTCDate()).padStart(2, "0")}/${String(when.getUTCMonth() + 1).padStart(2, "0")} ${String(when.getUTCHours()).padStart(2, "0")}:${String(when.getUTCMinutes()).padStart(2, "0")}Z` : "—";
      const names = hit.slice(0, 4).map(r => `${r.ticker}${direct.includes(r) ? "◄citata" : ""} ${fmtNum.format(wOf(r) ?? 0)}%`).join(" · ");
      // firma dei bersagli: più news macro che colpiscono ESATTAMENTE lo stesso gruppo si contano, non si ripetono
      const sig = hit.map(r => r.ticker).join(",");
      rows.push({ expo, sig, direct: direct.length > 0,
        txt: `  ${hhmm} · "${cut(it || en, 105)}" → ${names}${hit.length > 4 ? ` +${hit.length - 4}` : ""} = ${fmtNum.format(Math.round(expo * 10) / 10)}% NAV${ths.length ? ` [${ths.map(t => t.id).join(", ")}]` : ""}` });
    }
    // prima le news che citano un mio titolo, poi per esposizione
    rows.sort((a, b) => (b.direct ? 1 : 0) - (a.direct ? 1 : 0) || b.expo - a.expo);
    const shown = [], dupCount = new Map();
    for (const r of rows) {
      const k = r.direct ? `direct:${r.txt}` : r.sig;
      if (!r.direct && dupCount.has(k)) { dupCount.set(k, dupCount.get(k) + 1); continue; }
      dupCount.set(k, 1); shown.push(r);
    }
    if (shown.length) {
      L.push(`· ⏰ CATALIZZATORI NON ANCORA PREZZATI (${split.unpriced.length} news su ${split.total} pubblicate DOPO la chiusura del ${dd}: il prezzo che vedi NON le ha ancora viste). NON spiegano il passato — sono ciò che può muovere la PROSSIMA apertura, ed è qui che un ordine limite si vince o si perde. "◄citata" = la news nomina quel titolo (segnale specifico); senza, è esposizione tematica:`);
      for (const r of shown.slice(0, 6)) {
        const extra = !r.direct && dupCount.get(r.sig) > 1 ? `  (+${dupCount.get(r.sig) - 1} altre news sullo stesso gruppo)` : "";
        L.push(r.txt + extra);
      }
      if (shown.length > 6) L.push(`  (+${shown.length - 6} altri gruppi non prezzati a impatto minore)`);
    }
  }

  // ── 2) ROTAZIONE SETTORIALE → MIA ESPOSIZIONE ─────────────────────────────
  const tilt = ((DATA.macro || {}).tilt || []).filter(x => x && dgFin(x.m1) != null);
  if (tilt.length) {
    const themeOf = (name) => NEWS_THEMES.find(t => new RegExp(t.id.split("/")[0], "i").test(name)
      || (t.id === "SEMI/CHIP" && /semicondut/i.test(name)) || (t.id === "ENERGIA/OIL" && /energia/i.test(name))
      || (t.id === "NUCLEARE/UTILITY" && /utilit/i.test(name)) || (t.id === "CLOUD/SOFTWARE" && /software|cloud/i.test(name)));
    // ordina per ESPOSIZIONE (dove il book è pesante), non per performance del settore: il vento
    // che conta di più è quello sul 53% in semi, non il +11% dell'energia dove non hai nulla (v156).
    const rows = [];
    for (const s of tilt) {
      const th = themeOf(s.name || "");
      const mine = th && th.sel ? themeMembers(th, held) : [];
      if (!mine.length) continue;
      const expo = mine.reduce((acc, r) => acc + (wOf(r) ?? 0), 0);
      const rsAvg = mine.map(rsOf).filter(x => x != null);
      rows.push({ expo, txt: `  ${s.name} (${s.ticker}) ${signTxt(dgFin(s.m1))} 1M → tue posizioni: ${mine.map(r => r.ticker).join("+")} = ${fmtNum.format(Math.round(expo * 10) / 10)}% del NAV${rsAvg.length ? ` · RS media ${signTxt(Math.round(rsAvg.reduce((a, b) => a + b, 0) / rsAvg.length * 10) / 10, "pp")}` : ""}` });
    }
    if (rows.length) {
      rows.sort((a, b) => b.expo - a.expo);
      L.push("· VENTO SETTORIALE vs DOVE SEI PESANTE (rotazione 1M incrociata col book, dal settore dove pesi di più):");
      L.push(...rows.map(r => r.txt));
    }
  }

  // ── 3) DIVERGENZE: dove i dati si contraddicono (gli SPUNTI da spiegare) ──
  // v156: oltre alle contraddizioni INTRA-titolo (tema caldo/RS debole, MCR≫peso, stop vicino)
  // il motore ora incrocia BLOCCHI che prima restavano scollegati: il candidato d'accumulo contro
  // il TRACK RECORD del motore su quello stesso nome, e la RS che ACCELERA su un nome in veto FORTE
  // (momentum di brevissimo vs distruzione di valore di fondo). Sono le contraddizioni che l'LLM
  // non vede da solo perché vivono in tabelle lontane nel payload.
  const divRelapse = [], divMcr = [], divTheme = [], divAccel = [], divStop = [], divMeta = [];
  // v160 — SEGNALI STRUTTURATI per l'auto-misurazione. Le divergenze sono AFFERMAZIONI verificabili
  // ("il flusso non conferma la narrativa su MU"): fra 7-30 giorni i prezzi dicono da soli se erano
  // informative. Esporle in forma strutturata permette al CI (log_verdict.mjs) di scorarle SENZA
  // alcun input manuale — è l'unico modo di misurare la qualità dell'analisi a costo zero per il CEO.
  LAST_DIV_SIGNALS = [];
  const sig = (tk, kind) => { LAST_DIV_SIGNALS.push({ tk, kind }); };
  let dvL = null;
  try { dvL = decisionVerdict(); } catch { dvL = null; }

  // 3z) META-DIVERGENZA (v159): il VERDETTO del motore contro il REGIME di rischio del motore stesso.
  // È la contraddizione che contiene tutte le altre e che il sistema non calcolava: i singoli detector
  // dicevano "MU concentra il rischio", "AMD idem", ma nessuno diceva che il motore sta CHIEDENDO di
  // aumentare proprio quella concentrazione. Un CIO che legge 5 candidati e non nota che 4 sono dello
  // stesso settore in cui è già sovrappesato (in un settore che per giunta perde) sta subendo il
  // verdetto invece di pesarlo. Qui il conflitto si dichiara, non si risolve: la scelta resta del CEO.
  if (dvL && (dvL.accumula || []).length) {
    const cands = dvL.accumula;
    const secOf = (r) => thIsSemi(r) ? "Semiconduttori/memoria" : (r.sector || "n.d.");
    const bySec = new Map();
    for (const r of cands) { const s = secOf(r); bySec.set(s, [...(bySec.get(s) || []), r.ticker]); }
    // settore dominante fra i candidati
    let top = null;
    for (const [s, tks] of bySec) if (!top || tks.length > top[1].length) top = [s, tks];
    if (top && top[1].length >= 2 && top[1].length / cands.length >= 0.5) {
      // esposizione ATTUALE del book su quel settore + vento settoriale 1M
      const mine = ptf.filter(r => secOf(r) === top[0]);
      const expoNow = mine.reduce((s, r) => s + (wOf(r) ?? 0), 0);
      const mcrNow = mine.reduce((s, r) => s + (mcrOf(r) ?? 0), 0);
      const tiltRow = ((DATA.macro || {}).tilt || []).find(x => /semicond/i.test(x.name || "") ) ;
      const wind = (top[0].startsWith("Semi") && tiltRow && dgFin(tiltRow.m1) != null) ? dgFin(tiltRow.m1) : null;
      if (expoNow >= 25) {
        // ONESTÀ VERSO IL MOTORE: se fra i candidati c'è già un nome FUORI dal settore dominante e
        // a bassa correlazione col book, la via di de-correlazione non è un'idea astratta — è una
        // riga della stessa lista. Nominarla evita che la meta-divergenza suoni come "il motore
        // sbaglia sempre": spesso il motore la de-correlazione l'ha già proposta, in cima.
        const others = cands.filter(r => !top[1].includes(r.ticker));
        const deCorr = others.map(r => {
          const c = dgFin(r.avg_corr);
          return `${r.ticker}${c != null ? ` (corr. media col book ${fmtNum.format(c)})` : ""}`;
        });
        const altTxt = deCorr.length
          ? ` · candidati FUORI da quel settore: ${deCorr.join(", ")}` : " · nessun candidato fuori da quel settore";
        top[1].forEach(tk => sig(tk, "verdict_vs_regime"));
        // il motore ottimizza un titolo per volta e non modella il portafoglio risultante: qui si
        // espone il fatto (dove sono i candidati vs dove è già il rischio), la lettura è dell'LLM.
        divMeta.push(`  ⚑ CANDIDATI vs CONCENTRAZIONE: verdetto ${dvL.label} · ${top[1].length} dei ${cands.length} candidati (${top[1].join(", ")}) sono ${top[0]} · esposizione attuale del book su quel settore ${fmtNum.format(Math.round(expoNow * 10) / 10)}% del NAV e ${fmtNum.format(Math.round(mcrNow * 10) / 10)}% della varianza${wind != null ? ` · vento settoriale ${signTxt(wind)} a 1M` : ""}${altTxt}`);
      }
    }
  }

  // 3a) candidato d'accumulo che il motore ha GIÀ giocato e perso (track record del nome)
  const losers = new Map(((DATA.verdict_track || {}).last || [])
    .filter(s => s && dgFin(s.ret_pct) != null && dgFin(s.ret_pct) < 0).map(s => [s.tk, s]));
  for (const r of (dvL && dvL.accumula || [])) {
    const s = losers.get(r.ticker);
    if (s) sig(r.ticker, "relapse");
    // v200: niente etichetta ACCUMULA e niente punteggio — resta il FATTO che conta, cioe' che
    // il filtro ripropone oggi un nome su cui il segnale precedente ha gia' avuto un esito misurato.
    if (s) divRelapse.push(`  ${r.ticker}: supera i filtri oggi · precedente segnale del motore su questo nome il ${s.date}: reso ${signTxt(dgFin(s.ret_pct))} (vs NDX ${signTxt(dgFin(s.vs_ndx_pp), "pp")})`);
  }

  // 3d) nomi in VETO FORTE con la forza relativa che ACCELERA (rimbalzo tecnico vs valore rotto)
  const vetoStrong = new Map((dvL && dvL.excluded || [])
    .filter(x => x && x.r && held.has(x.r.ticker) && String(x.strength || "").toLowerCase() === "forte")
    .map(x => [x.r.ticker, x]));

  for (const r of ptf) {
    const rs = rsOf(r), w = wOf(r), m = mcrOf(r);
    if (m != null && w != null && m >= w * 1.6 && m >= 15) {
      sig(r.ticker, "mcr_over_weight");
      divMcr.push(`  ${r.ticker}: peso ${fmtNum.format(w)}% del NAV · quota di varianza ${fmtNum.format(m)}% (${fmtNum.format(Math.round(m / w * 10) / 10)}× il peso)`);
    }
    // v163: `t.targets` è la lista TRONCATA per la stampa — filtrarci sopra rendeva il detector
    // cieco sui nomi tagliati (ORCL, RS -23pp, il segnale più forte del book, veniva soppresso
    // mentre GOOGL a -3,7pp passava). Si filtra sull'elenco completo.
    const nTheme = themed.filter(t => (t.allTargets || t.targets).some(x => x.ticker === r.ticker));
    if (nTheme.length && rs != null && rs <= -3) {
      // v158 — QUALIFICATORE TEMPORALE: se la maggioranza delle news del tema è arrivata DOPO la
      // chiusura, il prezzo non ha ancora potuto votarle: chiamarla "il flusso non conferma" è un
      // errore logico (si confronta un prezzo di venerdì con una notizia di sabato). In quel caso
      // la riga cambia natura: non è una contraddizione, è una tesi ancora da verificare all'apertura.
      const totNews = nTheme.reduce((s, t) => s + t.n, 0);
      const totUnpriced = nTheme.reduce((s, t) => s + (t.nUnpriced || 0), 0);
      const priceBlind = marketClosed && totNews > 0 && totUnpriced / totNews >= 0.5;
      sig(r.ticker, priceBlind ? "theme_rs_blind" : "theme_rs");
      // v166 — SCALE TEMPORALI: la RS è una misura a UN MESE. Dire "il prezzo non ha ancora votato"
      // la annullava del tutto per via di news di poche ore — l'errore speculare a quello del
      // roll-off corretto in v163 (confondere l'orizzonte della metrica con quello dell'evento).
      // Una debolezza relativa lunga un mese resta un fatto: le news fresche NON la spiegano e NON
      // la cancellano. La riga ora tiene insieme le due verità invece di sostituirne una all'altra.
      divTheme.push(priceBlind
        ? `  ${r.ticker}: nei temi [${nTheme.map(t => t.id).join(", ")}] · RS 1M ${signTxt(rs, "pp")} vs NDX (finestra: 30 giorni) · di quelle news ${totUnpriced}/${totNews} sono POSTERIORI all'ultima chiusura, quindi non ancora nel prezzo né nella RS`
        : `  ${r.ticker}: nei temi [${nTheme.map(t => t.id).join(", ")}] · RS 1M ${signTxt(rs, "pp")} vs NDX · di quelle news ${totUnpriced}/${totNews} sono posteriori all ultima chiusura`);
    }
    const v = vetoStrong.get(r.ticker);
    if (v) {
      const d = dgFin(titleKinematics(r.ticker).drs7);
      if (d != null && d >= 5) {
        // v163 — LA RS CHE SALE NON È UN RIMBALZO. drs7 è il Δ7g della RS a 1 MESE: una finestra
        // mobile. Se un crollo di 4 settimane fa ESCE dalla finestra, la RS migliora di colpo
        // mentre il prezzo continua a scendere. Il payload verbalizzava quel salto come "momentum
        // di brevissimo" e chiedeva "vendere in forza o inversione vera?" su nomi che stavano
        // facendo nuovi minimi (MSTR -6,3% e ORCL -5,3% nei 7g citati, entrambi PEGGIO dell'indice,
        // ORCL pure con lo stop violato): entrambe le opzioni presupponevano un rimbalzo inesistente.
        // Ora si guarda il PREZZO nella stessa finestra e la riga dice la verità in entrambi i casi.
        const p7 = (() => { const a = ((r.sparks || {}).w1 || []).map(dgFin).filter(x => x != null);
          return a.length >= 2 ? (a[a.length - 1] / a[0] - 1) * 100 : null; })();
        const b7 = (() => { const bm = (DATA.watchlist || []).find(x => x.ticker === "^IXIC")
            || (DATA.top_etfs || []).find(x => x.ticker === "QQQ");
          const a = ((bm || {}).sparks || {}).w1 || []; const xs = a.map(dgFin).filter(x => x != null);
          return xs.length >= 2 ? (xs[xs.length - 1] / xs[0] - 1) * 100 : null; })();
        const realRebound = p7 != null && (b7 == null ? p7 > 0 : p7 > b7);
        const rsNow = rsOf(r);
        const lvl = rsNow != null ? ` (RS ora ${signTxt(rsNow, "pp")})` : "";
        const px = p7 != null ? `prezzo ${signTxt(Math.round(p7 * 10) / 10)} a 7g${b7 != null ? ` vs benchmark ${signTxt(Math.round(b7 * 10) / 10)}` : ""}` : "prezzo 7g n.d.";
        sig(r.ticker, realRebound ? "accel_into_veto" : "rs_rolloff_artifact");
        // NB: la RS 1M è una finestra MOBILE — può migliorare per il solo uscire di un crollo
        // vecchio, senza alcun rimbalzo. Per questo si stampa accanto il prezzo della STESSA
        // finestra: i due dati insieme dicono se l'accelerazione ha un movimento sotto o no.
        divAccel.push(`  ${r.ticker}: RS 1M ${signTxt(d, "pp")} in 7g${lvl} · ${px} · veto FORTE in essere (${(v.why || [])[0] || "value trap"})${r.stop_violated || (r.qty && stopOf(r) && stopOf(r).violated) ? " · STOP VIOLATO" : ""}${realRebound ? "" : " · [la RS sale mentre il prezzo scende: parte del miglioramento viene dall'uscita del crollo precedente dalla finestra a 30 giorni]"}`);
      }
    }
    const st = r.qty ? stopOf(r) : null;
    if (st && st.stop > 0 && r.price > 0 && !st.violated) {
      const dist = (r.price / st.stop - 1) * 100;
      if (dist <= 3 && (w ?? 0) >= 5) sig(r.ticker, "stop_near");
      if (dist <= 3 && (w ?? 0) >= 5) divStop.push(`  ${r.ticker}: stop a ${signTxt(Math.round(dist * 10) / 10)} dal prezzo · posizione ${fmtNum.format(w)}% del NAV`);
    }
  }
  // la meta-divergenza apre: è la cornice dentro cui vanno lette le altre
  const div = [...divMeta, ...divRelapse, ...divMcr, ...divTheme, ...divAccel, ...divStop];
  if (div.length) {
    L.push("· DATI IN TENSIONE (coppie di numeri che il sistema accosta perché raramente stanno insieme; NON sono conclusioni: la lettura, e se ci sia davvero una contraddizione, le decidi tu):");
    L.push(...div.slice(0, 8));
  }

  if (!L.length) return "";
  return "=== CORRELAZIONI CALCOLATE — COSA MUOVE IL TUO PORTAFOGLIO OGGI ===\n"
       + "(join news↔settori↔posizioni calcolato dal sistema: sotto ci sono i collegamenti già fatti, non le loro conseguenze)\n"
       + L.join("\n");
}

function buildCIOText() {
  const link = marketLinkText();
  const brief = buildExecutiveDelta();
  const full = buildPrompt();
  const historical = historicalDigestText();
  // HOISTING del blocco sintesi (v156) — la testata è costruita attorno a "Parti dal blocco
  // CORRELAZIONI CALCOLATE / le DIVERGENZE sono il cuore del lavoro", ma appeso in coda quel blocco
  // finiva al ~78% del payload: DOPO tutte le tabelle-silo e persino dopo "PROMEMORIA FINALE" (che
  // legge come chiusura). Il lettore incontrava la SINTESI per ultima, dopo 49k caratteri di dump →
  // esattamente ciò che spinge alla parafrasi. Ora lo splice mette il blocco SUBITO dopo la testata
  // (confine = promptHeaderText, la fonte di verità), adiacente all'istruzione che lo richiama e
  // PRIMA dei dati grezzi, che restano come materiale di verifica. buildPrompt() NON viene toccato
  // (Regola Suprema): si ricompone solo la stringa sul confine testata↔payload.
  // (v180: la logica che spostava "PROMEMORIA FINALE" in coda è stata rimossa insieme al blocco —
  // duplicava per intero testata [A2] e [D]. Restava codice morto: lastIndexOf non trovava più nulla.)
  const header = promptHeaderText();
  let body = full;
  if (full.startsWith(header)) {
    const rest = full.slice(header.length).replace(/^\n+/, "");
    body = header + (link ? "\n\n" + link : "") + "\n\n" + rest;
  } else if (link) {
    body = full + "\n\n" + link;   // confine non combaciante: fallback alla coda (comportamento pre-v156)
  }
  // TIMBRO DI BUILD in cima a tutto: versione del codice (prova che Safari non ha servito una
  // pagina in cache) + ora di generazione lato client (prova che il run è di adesso).
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `⟦ BUILD v${BUILD_VERSION} · generato ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())} · se questa versione è più vecchia del sito, Safari ha una pagina in cache → ricarica forzato ⟧`;
  return stamp + "\n\n" + brief + "\n\n" + body
       + (historical ? "\n\n" + historical : "");
}

/* ---------- azione unica: copia il pacchetto completo e mostralo nella modal ---------- */
async function copyCIOText() {
  if (!DATA) { toast("Dati non ancora caricati, riprova tra un attimo"); return; }
  const text = buildCIOText();
  $("#prompt-text").value = text;   // visibile/editabile nel box (e copiabile a mano se la clipboard manca, es. iOS)
  $("#modal").hidden = false;
  try {
    await navigator.clipboard.writeText(text);
    toast("Analisi AI copiata ✓ — incollala in Claude");
  } catch { /* clipboard non disponibile: si copia dal box */ }
}


/* ---------------- eventi ---------------- */
$("#btn-refresh").addEventListener("click", refreshAll);
$("#btn-cio")?.addEventListener("click", copyCIOText);
$("#modal-close").addEventListener("click", () => { $("#modal").hidden = true; });
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("#modal").hidden = true; });
$("#btn-copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("#prompt-text").value);   // copia il testo EDITATO
  toast("Copiato (con le tue modifiche) ✓");
});
/* ---------------- calcolo vendite (plus/minusvalenze) ---------------- */
const sellPriceOv = {};   // prezzo di vendita inserito a mano per ticker (override del prezzo di mercato)
const sellQtyOv = {};     // quantità da vendere digitate: sopravvivono a un eventuale re-render

function sellRows() {
  const eur = DATA.eurusd || 1.08;
  return DATA.portfolio.map(r => {
    const toEur = r.currency === "EUR" ? 1 : 1 / eur;
    const price = sellPriceOv[r.ticker] != null ? sellPriceOv[r.ticker] : r.price;   // override manuale
    const plPerShare = (price - r.pmc) * toEur;   // utile/perdita per azione in €
    return { ...r, price, plPerShare, taxRate: r.ticker === "BTP-V28" ? 0.125 : 0.26 };
  });
}

function renderSellCalc() {
  const rows = sellRows();
  $("#sell-table tbody").innerHTML = rows.map(r => {
    const c = cur(r);
    const edited = sellPriceOv[r.ticker] != null;
    return `<tr data-tk="${r.ticker}">
      <td class="name-cell">${r.name}<span class="tk">${r.ticker}</span></td>
      <td class="num">${fmtNum.format(r.qty)}</td>
      <td class="num">${c}${fmtNum.format(r.pmc)}</td>
      <td class="num sell-price-cell">
        <span class="sp-cur">${c}</span><input type="number" inputmode="decimal" class="sell-price${edited ? " sp-edited" : ""}" data-tk="${r.ticker}" value="${r.price}" step="any" title="Prezzo di vendita — modificabile a mano (✎)" style="width:74px">
        <span class="sp-pencil" title="Prezzo modificabile a mano">✎</span>
      </td>
      <td class="num"><input type="number" inputmode="decimal" class="sell-in" data-tk="${r.ticker}" min="0" max="${r.qty}" step="any" placeholder="0" value="${sellQtyOv[r.ticker] ?? ""}" style="width:70px"><button class="sell-all" data-tk="${r.ticker}" title="Vendi tutta la posizione">tutte</button></td>
      <td class="num sell-pl" data-tk="${r.ticker}">—</td>
    </tr>`;
  }).join("");
  document.querySelectorAll(".sell-in").forEach(i => i.addEventListener("input", () => {
    const v = parseFloat(i.value);
    if (v > 0) sellQtyOv[i.dataset.tk] = i.value; else delete sellQtyOv[i.dataset.tk];
    computeSell();
  }));
  document.querySelectorAll(".sell-all").forEach(b => b.addEventListener("click", () => {
    const inp = document.querySelector(`.sell-in[data-tk="${b.dataset.tk}"]`);
    const r = sellRows().find(x => x.ticker === b.dataset.tk);
    if (inp && r) { inp.value = r.qty; sellQtyOv[r.ticker] = String(r.qty); computeSell(); }
  }));
  document.querySelectorAll(".sell-price").forEach(i => i.addEventListener("input", () => {
    const tk = i.dataset.tk, v = parseFloat(i.value);
    if (v > 0) { sellPriceOv[tk] = v; i.classList.add("sp-edited"); } else { delete sellPriceOv[tk]; i.classList.remove("sp-edited"); }
    computeSell();
  }));
  applyColLabels("sell-table");   // etichette per la vista a schede su iPhone (input sempre visibili)
  computeSell();
}

function computeSell() {
  const rows = sellRows();
  const byTk = Object.fromEntries(rows.map(r => [r.ticker, r]));
  let gains = 0, losses = 0, taxStock = 0, taxBtp = 0, stockNet = 0, btpNet = 0;
  let grossProceeds = 0, totalCost = 0;
  document.querySelectorAll(".sell-in").forEach(inp => {
    const r = byTk[inp.dataset.tk];
    const q = Math.min(parseFloat(inp.value) || 0, r.qty);
    const pl = r.plPerShare * q;
    const cell = document.querySelector(`.sell-pl[data-tk="${inp.dataset.tk}"]`);
    if (q) {
      cell.textContent = signTxt(Math.round(pl), " €");
      cell.className = `num sell-pl ${signCls(pl)}`;
    } else {
      // anteprima: plus/minus latente se vendi TUTTA la posizione (così il popup è subito utile)
      const full = r.plPerShare * r.qty;
      cell.innerHTML = `<span class="muted" title="plus/minus se vendi tutta la posizione (${fmtNum.format(r.qty)} az.)">(${signTxt(Math.round(full), " €")})</span>`;
      cell.className = "num sell-pl";
    }
    if (q) {
      if (pl >= 0) gains += pl; else losses += pl;
      // prezzo di vendita × quantità (convertito in EUR se USD)
      const eurusd = DATA.eurusd || 1;
      const priceEur = r.currency === "USD" ? r.price / eurusd : r.price;
      const pmcEur   = r.currency === "USD" ? r.pmc   / eurusd : r.pmc;
      grossProceeds += priceEur * q;
      totalCost     += pmcEur * q;
    }
    if (r.ticker === "BTP-V28") btpNet += pl; else stockNet += pl;
  });
  // minusvalenze compensano le plusvalenze; tassa solo sul netto positivo
  taxStock = 0.26 * Math.max(0, stockNet);
  taxBtp = 0.125 * Math.max(0, btpNet);
  const net = gains + losses;          // losses è negativo
  const tax = taxStock + taxBtp;
  const afterTax = net - tax;
  // "Incasso netto" = liquidità effettiva ricevuta = controvalore vendita − tasse sulla plusvalenza
  // NON è solo il guadagno netto: include anche il capitale restituito (costo di acquisto)
  const cashReceived = grossProceeds - tax;
  const hasData = grossProceeds > 0;
  // grafico a barre: plus (verde), minus (rosso), netto
  const maxAbs = Math.max(gains, Math.abs(losses), Math.abs(net), 1);
  const bar = (v, col, label) => `<div class="sb-row"><span class="sb-lab">${label}</span>
    <span class="sb-track"><span class="sb-fill" style="width:${Math.abs(v) / maxAbs * 100}%;background:${col}"></span></span>
    <span class="sb-val ${signCls(v)}">${signTxt(Math.round(v), " €")}</span></div>`;
  $("#sell-summary").innerHTML = `
    <div class="sell-bars">
      ${bar(gains, "var(--green)", "Plusvalenze")}
      ${bar(losses, "var(--red)", "Minusvalenze")}
      ${bar(net, net >= 0 ? "var(--blue)" : "var(--red)", "Guad./Perd. netto")}
    </div>
    <div class="sell-totals">
      ${hasData ? `<div class="sell-tot-section"><span class="muted">Controvalore vendita</span>
        <b>${fmtEUR.format(Math.round(grossProceeds))}</b>
        <span class="sell-tot-note">Prezzo di mercato × quantità venduta (quanto entrerà sul conto dal broker)</span></div>` : ""}
      <div><span class="muted">Costo di acquisto (PMC × qtà)</span> <b class="muted">${hasData ? "−" + fmtEUR.format(Math.round(totalCost)) : "—"}</b></div>
      <div><span class="muted">Plusvalenze</span> <b class="pos">${signTxt(Math.round(gains), " €")}</b></div>
      <div><span class="muted">Minusvalenze</span> <b class="neg">${signTxt(Math.round(losses), " €")}</b></div>
      <div><span class="muted">Risultato lordo (plus − minus)</span> <b class="${signCls(net)}">${signTxt(Math.round(net), " €")}</b></div>
      <div><span class="muted">Tasse stimate (26% az. / 12,5% BTP, al netto delle minus)</span> <b class="neg">${tax > 0 ? "−" + fmtEUR.format(Math.round(tax)) : "0 €"}</b></div>
      <div class="sell-net-box">
        <div class="sell-net-main"><span>Liquidità netta sul conto</span> <b class="${cashReceived >= 0 ? "pos" : "neg"}">${hasData ? fmtEUR.format(Math.round(cashReceived)) : "—"}</b></div>
        <div class="sell-net-note">Controvalore vendita (${hasData ? fmtEUR.format(Math.round(grossProceeds)) : "—"}) − tasse (${fmtEUR.format(Math.round(tax))}) = cash effettivo ricevuto sul conto. Diverso dal "guadagno netto" che è solo la differenza rispetto al costo di acquisto.</div>
      </div>
      <div class="sell-gain-box"><span class="muted">Di cui guadagno/perdita netto dopo tasse</span> <b class="${signCls(afterTax)}">${signTxt(Math.round(afterTax), " €")}</b>
        <span class="sell-tot-note">Solo il profitto/perdita rispetto al tuo PMC (non include il capitale restituito)</span></div>
    </div>`;
}

/* ---------------- calcolatore PMC ---------------- */
let pmcMode = "buy";   // "buy" = mediazione su acquisto · "sell" = realizzo su vendita

function pmcSetMode(mode) {
  pmcMode = mode === "sell" ? "sell" : "buy";
  document.querySelectorAll("#pmc-mode .chip").forEach(c =>
    c.classList.toggle("chip-active", c.dataset.pmcMode === pmcMode));
  const sell = pmcMode === "sell";
  $("#pmc-b2-label").textContent = sell ? "Vendita" : "Nuovo acquisto";
  $("#pmc-q2-label").textContent = sell ? "Quantità da vendere" : "Quantità";
  $("#pmc-p2-label").textContent = sell ? "Prezzo di vendita" : "Prezzo";
  $("#pmc-q2").placeholder = sell ? "es. 50" : "es. 50";
  $("#pmc-p2").placeholder = sell ? "es. 130" : "es. 120";
  const cl = $("#pmc-comm-label"); if (cl) cl.hidden = sell;   // commissioni solo in acquisto
  pmcCompute();
}

function pmcCompute() {
  const v = (id) => parseFloat($(id).value) || 0;
  const q1 = v("#pmc-q1"), p1 = v("#pmc-p1"), q2 = v("#pmc-q2"), p2 = v("#pmc-p2");
  const clear = () => ["#pmc-new", "#pmc-qty", "#pmc-cost", "#pmc-delta"].forEach(id => { $(id).textContent = "—"; $(id).className = id === "#pmc-new" ? "" : "muted"; });

  const opRow = $("#pmc-opcost-row");

  if (pmcMode === "sell") {
    if (opRow) opRow.hidden = true;
    // VENDITA: il PMC NON cambia; si realizza una plus/minusvalenza sulle azioni vendute
    $("#pmc-r1-lab").textContent = "PMC (invariato):";
    $("#pmc-r2-lab").textContent = "Quantità residua:";
    $("#pmc-r3-lab").textContent = "Plus/Minus realizzata:";
    $("#pmc-r4-lab").textContent = "Controvalore venduto:";
    if (q1 <= 0 || p1 <= 0 || q2 <= 0 || p2 <= 0) { clear(); return; }
    const sellQty = Math.min(q2, q1);
    const remaining = q1 - sellQty;
    const realized = sellQty * (p2 - p1);     // plus/minus sulle azioni vendute
    const proceeds = sellQty * p2;
    $("#pmc-new").textContent = fmtNum.format(Math.round(p1 * 10000) / 10000);
    $("#pmc-new").className = "";
    $("#pmc-qty").textContent = fmtNum.format(remaining) + (q2 > q1 ? " (vendita > posizione: limitata)" : "");
    $("#pmc-qty").className = "muted";
    const el3 = $("#pmc-cost");
    el3.textContent = signTxt(Math.round(realized * 100) / 100, "");   // valuta del titolo, nessun "%"
    el3.className = signCls(realized);
    $("#pmc-delta").textContent = fmtNum.format(Math.round(proceeds * 100) / 100);
    $("#pmc-delta").className = "muted";
    return;
  }

  // ACQUISTO (mediazione): PMC ponderato sui due lotti
  $("#pmc-r1-lab").textContent = "Nuovo PMC:";
  $("#pmc-r2-lab").textContent = "Quantità totale:";
  $("#pmc-r3-lab").textContent = "Investimento totale:";
  $("#pmc-r4-lab").textContent = "Variazione PMC:";
  const qty = q1 + q2, cost = q1 * p1 + q2 * p2;
  if (qty <= 0 || cost <= 0) { if (opRow) opRow.hidden = true; clear(); return; }
  const pmc = cost / qty;
  $("#pmc-new").textContent = fmtNum.format(Math.round(pmc * 10000) / 10000);
  $("#pmc-new").className = "";
  $("#pmc-qty").textContent = fmtNum.format(qty);
  $("#pmc-qty").className = "muted";
  $("#pmc-cost").textContent = fmtNum.format(Math.round(cost * 100) / 100);
  $("#pmc-cost").className = "muted";
  // Costo dell'operazione del nuovo acquisto: controvalore (qtà × prezzo) + commissioni
  if (opRow) {
    const comm = v("#pmc-comm");
    const newNotional = q2 * p2;
    if (q2 > 0 && p2 > 0) {
      opRow.hidden = false;
      const tot = newNotional + comm;
      $("#pmc-opcost").textContent = fmtNum.format(Math.round(tot * 100) / 100)
        + (comm > 0 ? ` (controvalore ${fmtNum.format(Math.round(newNotional * 100) / 100)} + comm. ${fmtNum.format(comm)})` : "");
    } else {
      opRow.hidden = true;
    }
  }
  const el = $("#pmc-delta");
  if (p1 > 0) {
    const d = (pmc / p1 - 1) * 100;
    el.textContent = signTxt(Math.round(d * 100) / 100);
    el.className = signCls(d);
  } else {
    el.textContent = "—"; el.className = "muted";
  }
}

function pmcInit() {
  const sel = $("#pmc-select");
  const current = sel.value;
  const opt = r => `<option value="${r.ticker}">${esc(r.name || r.ticker)} (${r.ticker})</option>`;
  const ptf = (DATA.portfolio || []).filter(r => r.currency === "USD");
  const wl = (DATA.watchlist || []).filter(r => r.currency === "USD");
  let html = '<option value="">— scegli un titolo o inserisci a mano —</option>';
  if (ptf.length) html += `<optgroup label="Portafoglio">${ptf.map(opt).join("")}</optgroup>`;
  if (wl.length) html += `<optgroup label="Watchlist">${wl.map(opt).join("")}</optgroup>`;
  sel.innerHTML = html;
  sel.value = current;   // non perdere la selezione sull'auto-refresh
}

$("#pmc-select").addEventListener("change", () => {
  const tk = $("#pmc-select").value;
  const r = [...(DATA?.portfolio || []), ...(DATA?.watchlist || [])].find(x => x.ticker === tk);
  if (r) {
    $("#pmc-q1").value = r.qty || "";          // watchlist: nessuna posizione → vuoto
    $("#pmc-p1").value = r.pmc || "";
    $("#pmc-p2").value = r.price || "";
    $("#pmc-q2").focus();
  }
  pmcCompute();
});
document.querySelectorAll("#pmc-mode .chip").forEach(c =>
  c.addEventListener("click", () => pmcSetMode(c.dataset.pmcMode)));
["#pmc-q1", "#pmc-p1", "#pmc-q2", "#pmc-p2", "#pmc-comm"].forEach(id =>
  $(id).addEventListener("input", pmcCompute));

/* liquidità + mini-card */
$("#cash-save").addEventListener("click", saveCash);
$("#cash-input").addEventListener("keydown", e => { if (e.key === "Enter") saveCash(); });
$("#portfolio-health")?.addEventListener("click", openHealthModal);
$("#tracking-error-box")?.addEventListener("click", openAlphaModal);
$("#ptf-edit-values")?.addEventListener("click", openEditPortfolio);
$("#alloc-edit")?.addEventListener("click", openEditPortfolio);
$("#kpi-edit")?.addEventListener("click", openEditPortfolio);
$("#btn-diary")?.addEventListener("click", openDecisionModal);
$("#sharpe-box")?.addEventListener("click", openPortfolioSharpeModal);
$("#fx-box")?.addEventListener("click", openFxModal);
$("#margin-debt-box")?.addEventListener("click", openMarginDebtModal);

/* popup Strumenti (PMC, vendite) e News */
function showSimpleModal(id) { const m = $(id); if (m) m.hidden = false; }
function hideSimpleModal(id) { const m = typeof id === "string" ? $(id) : id; if (m) m.hidden = true; }

/* ═══ v193 — I MODALI SEMPLICI NON SI CHIUDEVANO. Il ✕ di "Calcolatore PMC" e "Calcolo vendite"
   non ha MAI funzionato: i bottoni esistono in index.html da sempre, hideSimpleModal esisteva,
   ma nessuna riga le collegava. In v181 avevo rimosso hideSimpleModal come "codice morto" —
   ed era davvero non chiamata, ma la conclusione giusta non era "si puo' togliere": era "manca
   un collegamento". Una funzione morta a fianco di un bottone inerte non e' surplus, e' un
   sintomo. Ora la chiusura e' generica per TUTTI i .modal-backdrop, con le tre vie che un
   utente si aspetta: il ✕, il fondale, e Esc. Cosi' un modale aggiunto domani nasce chiudibile. */
document.addEventListener("click", (e) => {
  const chiudi = e.target.closest("[id$='-modal-close'], [data-close-modal]");
  if (chiudi) { hideSimpleModal(chiudi.closest(".modal-backdrop")); return; }
  // clic sul fondale (non sul contenuto) chiude
  const back = e.target.closest(".modal-backdrop");
  if (back && e.target === back) hideSimpleModal(back);
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const aperti = [...document.querySelectorAll(".modal-backdrop:not([hidden])")];
  if (aperti.length) hideSimpleModal(aperti[aperti.length - 1]);   // si chiude l'ultimo aperto
});
$("#open-pmc")?.addEventListener("click", () => { pmcInit(); pmcCompute(); showSimpleModal("#pmc-modal"); });
$("#open-sell")?.addEventListener("click", () => { renderSellCalc(); showSimpleModal("#sell-modal"); });

/* v141: l'editor UI della testata (⚙ Impostazioni Prompt) è stato RIMOSSO su direttiva CEO:
   la Costituzione in config/prompt_header.txt si mantiene via repo. loadPromptHeaderCloud()
   resta: il file è ancora la fonte di verità caricata a ogni avvio. */
$("#market-direction")?.addEventListener("click", () => {
  const d = marketDirectionScore();
  const comps = directionComponents();
  const lab = d >= 60 ? "Rialzista" : d <= 40 ? "Ribassista" : "Laterale";
  const rows = comps.map(c =>
    `<tr><td>${esc(c.label)}</td><td style="min-width:130px">${meterBar(c.score, scoreColor(c.score), String(c.score))}</td></tr>`).join("");
  openInfoModal("Direzione di mercato — sintesi di tutti i segnali",
    `<div class="info-line">Punteggio aggregato: <b style="color:${scoreColor(d)}">${d}% · ${lab}</b></div>
     <p class="muted" style="margin:4px 0 8px">Media di TUTTI gli indicatori del sistema (sentiment, F&amp;G, VIX, valutazione, BofA, MacroQuant, Fed, carry, dati macro, rotazione settoriale). >60% rialzista, <40% ribassista.</p>
     <table class="info-table"><thead><tr><th>Segnale</th><th>Punteggio (0–100)</th></tr></thead><tbody>${rows}</tbody></table>`);
});
// click sul termometro Financial Health → modale Conto economico
document.addEventListener("click", e => {
  const fh = e.target.closest(".fin-health");
  if (fh) { openStockCard(fh.dataset.fin); return; }
  const fr = e.target.closest(".fund-row");            // riga vista fondamentale → conto economico + statistiche
  if (fr) { openStockCard(fr.dataset.fundTk); return; }
  const sc = e.target.closest(".stat-cell");           // click su una metrica → spiegazione
  if (sc) { toast(sc.dataset.info); return; }
  const rc = e.target.closest(".rs-cell");             // click su RS 1M → spiegazione forza relativa
  if (rc && rc.dataset.rsTk) { openStockCard(rc.dataset.rsTk); return; }   // v188: un solo popup per titolo
  const shc = e.target.closest(".sharpe-cell");        // click su Sharpe 1A → spiegazione
  if (shc && shc.dataset.sharpeTk) { openStockCard(shc.dataset.sharpeTk); return; }
  const bi = e.target.closest(".badge-info");          // badge (squeeze/deep value/correzione) → spiegazione
  if (bi && bi.dataset.badge) { e.stopPropagation(); openBadgeInfo(bi.dataset.badge); return; }
  // tap su QUALSIASI punto della riga/card del titolo (no su pulsanti, grafico, opzioni o celle
  // già interattive) → scheda completa. Indispensabile su iPhone dove la riga è una card.
  const tr = e.target.closest("#ptf-table tbody tr, #wl-table tbody tr");
  if (tr && !tr.classList.contains("total-row") && !tr.classList.contains("add-row")
      && !e.target.closest("button, a, input, .spark-cell, [data-opt], .rs-cell, .sharpe-cell, .badge-info")) {
    const tk = tr.querySelector(".name-cell")?.dataset.tk;
    if (tk) { openStockCard(tk); return; }   // v188: scheda UNICA, non piu' il solo dettaglio
  }
});
// accessibilità: Invio/Spazio sulla riga fondamentale aprono il dettaglio
document.addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const fr = e.target.closest && e.target.closest(".fund-row");
  if (fr) { e.preventDefault(); openFinancialsModal(fr.dataset.fundTk); return; }
  const rc = e.target.closest && e.target.closest(".rs-cell");
  if (rc && rc.dataset.rsTk) { e.preventDefault(); openRsInfo(rc.dataset.rsTk); }
});

// due barre range (sopra portafoglio e sopra watchlist) sincronizzate
function syncSparkToggles() {
  document.querySelectorAll("#spark-toggle .chip, #spark-toggle-wl .chip").forEach(c =>
    c.classList.toggle("chip-active", c.dataset.range === sparkRange));
}
document.querySelectorAll("#spark-toggle .chip, #spark-toggle-wl .chip").forEach(ch => {
  ch.addEventListener("click", () => {
    sparkRange = ch.dataset.range;
    localStorage.setItem("pref_range", sparkRange);   // ricorda l'intervallo scelto
    syncSparkToggles();
    renderTable();
    renderWatchlist();
  });
});
// v188: la vista tecnica/fondamentale non esiste piu' (tabella unica), quindi le barre
// dell'intervallo sono SEMPRE visibili: restava solo il ripristino dell'intervallo scelto.
(function applyPrefs() {
  syncSparkToggles();
  applicaOrdineMiniCard();   // v190: l'ordine scelto nel popup macro vale anche al caricamento
})();
$("#wl-add-top").addEventListener("click", addWatchlist);
$("#ptf-add-top")?.addEventListener("click", addPortfolio);
document.querySelectorAll("#alloc-toggle .chip").forEach(ch => {
  ch.addEventListener("click", () => {
    document.querySelectorAll("#alloc-toggle .chip").forEach(c => c.classList.remove("chip-active"));
    ch.classList.add("chip-active");
    allocMode = ch.dataset.mode;
    renderAllocation();
  });
});

// v214 — orizzonte del confronto col benchmark
document.querySelectorAll("#bench-toggle .chip").forEach(ch => {
  ch.addEventListener("click", () => {
    document.querySelectorAll("#bench-toggle .chip").forEach(c => c.classList.remove("chip-active"));
    ch.classList.add("chip-active");
    benchOrizzonte = ch.dataset.bench;
    renderVsBenchmark();
  });
});

// v206 — orizzonte della rotazione settoriale
document.querySelectorAll("#rot-toggle .chip").forEach(ch => {
  ch.addEventListener("click", () => {
    document.querySelectorAll("#rot-toggle .chip").forEach(c => c.classList.remove("chip-active"));
    ch.classList.add("chip-active");
    rotOrizzonte = ch.dataset.rot;
    renderRotazione();
  });
});

// v205 — interruttore settore/valuta della vista struttura
document.querySelectorAll("#alloc-graf-toggle .chip").forEach(ch => {
  ch.addEventListener("click", () => {
    document.querySelectorAll("#alloc-graf-toggle .chip").forEach(c => c.classList.remove("chip-active"));
    ch.classList.add("chip-active");
    allocGrafMode = ch.dataset.agmode;
    renderAllocGrafica();
  });
});

$("#chart-modal-close").addEventListener("click", closeChartModal);
$("#chart-modal").addEventListener("click", e => {
  if (e.target.id === "chart-modal") { closeChartModal(); return; }
  if (e.target.closest(".cm-opt-open")) { openOptionsModal(cmTicker); return; }
  if (e.target.closest(".cm-opt-back")) { optTicker = null; drawTickerChart(); return; }
  const sd = e.target.closest(".opt-side");
  if (sd) { optSide = sd.dataset.side; loadOptionsView(); return; }
  const vb = e.target.closest(".cm-viewbtn");
  if (vb) { cmView = vb.dataset.cmview; drawTickerChart(); return; }
  const rb = e.target.closest(".cm-range");
  if (rb) { cmView = "candles"; cmRange = rb.dataset.range; drawTickerChart(); }
});
$("#chart-modal").addEventListener("change", e => {
  if (e.target.classList.contains("opt-expiry")) { optExpIdx = Number(e.target.value); loadOptionsView(); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeChartModal(); });
document.addEventListener("click", (e) => {
  const optCell = e.target.closest("[data-opt]");
  if (optCell) { openOptionsModal(optCell.dataset.opt); return; }
  const cell = e.target.closest(".spark-cell");
  if (cell) { openTickerChart(cell.dataset.tk); return; }
  const macro = e.target.closest("[data-macro]");
  if (macro) { openMacroInfo(macro.dataset.macro); return; }
  const gauge = e.target.closest("[data-gauge]");
  if (gauge) { openMacroInfo(gauge.dataset.gauge); return; }
  const earn = e.target.closest("[data-earn]");
  if (earn) { openEarningsInfo(earn.dataset.earn); return; }
  const kpiC = e.target.closest('[data-kpi="alpha"]');
  if (kpiC) { openAlphaModal(); return; }
  if (e.target.closest('[data-action="rot-analyze"]')) { openRotationAnalysis(); return; }
});

/* v213 — QUI SI ROMPEVA TUTTO. Quattro addEventListener puntavano alle mini-card rimosse in
   v212 e NON avevano il `?.`: lo script moriva su `$("#signposts-box").addEventListener` e
   TUTTO IL WIRING SOTTO non veniva mai eseguito — compreso loadData(). La pagina restava vuota
   con "Aggiornamento totale: —", e io l'avevo attribuito alla rete del sandbox. Non era la rete.
   È la terza volta in questo progetto che un elemento rimosso rompe l'intero caricamento
   (CLAUDE.md lo dichiara come convenzione fissa), quindi ora c'è un gate che lo intercetta. */

/* modifica posizioni */
$("#ptf-edit")?.addEventListener("click", () => {
  editMode.portfolio = !editMode.portfolio;
  $("#ptf-edit")?.classList.toggle("chip-active", editMode.portfolio);
  renderTable();
});
$("#wl-edit")?.addEventListener("click", () => {
  editMode.watchlist = !editMode.watchlist;
  $("#wl-edit")?.classList.toggle("chip-active", editMode.watchlist);
  renderWatchlist();
});
document.addEventListener("click", (e) => {
  const del = e.target.closest(".row-del");
  if (del) { removeHolding(del.dataset.sec, del.dataset.tk); return; }
  const mv = e.target.closest(".row-move");
  if (mv) { moveHolding(mv.dataset.sec, mv.dataset.tk, +mv.dataset.dir); return; }
  const ed = e.target.closest(".row-edit");
  if (ed) { editPosition(ed.dataset.tk); return; }
  const add = e.target.closest(".row-add");
  if (add) { quickAddFromWatchlist(add.dataset.tk, parseFloat(add.dataset.price)); return; }
  if (e.target.id === "ptf-add" || e.target.id === "wl-add") {
    (e.target.id === "ptf-add" ? addPortfolio : addWatchlist)(); return;
  }
  // clic su un nome in watchlist → calcolatore PMC
  const nameCell = e.target.closest("#wl-table .name-cell");
  if (nameCell && !e.target.closest("button")) {
    const tr = nameCell.closest("tr");
    const tk = tr.querySelector(".tk")?.textContent;
    const row = (DATA.watchlist || []).find(w => w.ticker === tk);
    if (row) quickAddFromWatchlist(tk, row.price);
  }
});

/* sposta una posizione su (-1) o giù (+1); aggiorna subito e salva su config */
function moveHolding(section, ticker, dir) {
  const arr = DATA[section];
  const i = arr.findIndex(r => r.ticker === ticker);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];          // riordina subito (feedback istantaneo)
  section === "portfolio" ? renderTable() : renderWatchlist();
  editHoldings(section, cfg => {                 // persiste l'ordine su config/holdings.json
    const a = cfg[section] || [];
    const x = a.findIndex(r => r.ticker === ticker);
    const y = x + dir;
    if (x < 0 || y < 0 || y >= a.length) return false;
    [a[x], a[y]] = [a[y], a[x]];
    return true;
  });
}

/* dalla watchlist al calcolatore PMC / aggiungi al portafoglio */
// clic su un titolo della watchlist → precompila il "Nuovo acquisto" nel calcolatore PMC
function quickAddFromWatchlist(ticker, price) {
  $("#pmc-q1").value = 0;        // posizione attuale: nessuna (è in watchlist)
  $("#pmc-p1").value = 0;
  $("#pmc-q2").value = "";
  $("#pmc-p2").value = price || "";   // prezzo del nuovo acquisto
  pmcCompute();
  $("#pmc-calc")?.scrollIntoView({ behavior: "smooth" });
  toast(`${ticker} caricato nel calcolatore PMC — inserisci la quantità da simulare`);
}

initSorting("ptf-table", renderTable);
initSorting("wl-table", renderWatchlist);
initColDrag("ptf-table", renderTable);
initColDrag("wl-table", renderWatchlist);

controllaVersione();   // v216 — avvisa se il browser sta servendo una pagina vecchia
loadData();
loadDiaryCloud();   // sincronizza il diario azioni dal cloud (se presente)
loadPromptHeaderCloud();   // sincronizza la testata del prompt dal server (config/prompt_header.txt)
loadOverridesCloud();   // sincronizza gli override macro manuali (se presenti)
montaComandiSezioni();   // maniglia ⠿ + frecce ▲▼ su ogni sezione
applicaOrdineSezioni();  // ordine gia' noto a questo browser: subito, senza aspettare la rete
loadOrdineSezioniCloud();// e poi quello del repo, se piu' recente → Mac e iPhone allineati
loadStatoPortafoglioCloud();   // v244: cassa, posizioni manuali e BTP dal repo — la sincronizzazione che mancava
loadRiskParamsCloud();   // sincronizza i parametri di rischio del CEO (config/risk_params.json) — cap/veto uguali su ogni device
// ricarica completa (tecnici, news, storico) ogni 5 minuti
setInterval(() => loadData(), 5 * 60 * 1000);
// prezzi live ogni 60 secondi
setInterval(() => livePrices(), 60 * 1000);

/* v188 — comandi delle personalizzazioni */
$("#macro-details")?.addEventListener("click", () => openMacroDetails());
// v202: stesso pannello dalla topbar, visibile da ogni scheda. Spostare la macro dietro una
// scheda l'aveva resa irraggiungibile da tutte le altre — e per l'utente "non trovabile" e'
// indistinguibile da "non c'e'".
// v209 — l'handler di #btn-macro-top è uscito col suo bottone. `openMacroDetails` resta
// raggiungibile da #macro-details, dentro la scheda Macro: una sola porta, nella colonna
// centrale. La guardia strutturale è stata aggiornata di conseguenza — protegge l'ACCESSO
// ai dettagli macro, non quel particolare bottone (v203: mai zittire una guardia, cambiarle
// l'invariante quando l'invariante è cambiato davvero).
$("#ptf-cols")?.addEventListener("click", () => openColumnPicker("ptf-table", "Portafoglio", renderTable));
$("#wl-cols")?.addEventListener("click", () => openColumnPicker("wl-table", "Watchlist", renderWatchlist));
document.addEventListener("click", (e) => {
  const all = e.target.closest("[data-cp-all]");
  if (all) { saveColHidden(all.dataset.cpAll, new Set());
    (all.dataset.cpAll === "ptf-table" ? renderTable : renderWatchlist)();
    openColumnPicker(all.dataset.cpAll, all.dataset.cpAll === "ptf-table" ? "Portafoglio" : "Watchlist",
      all.dataset.cpAll === "ptf-table" ? renderTable : renderWatchlist);
    return; }
  if (e.target.closest("[data-cp-done]")) { $("#chart-modal").hidden = true; return; }
  const ch = e.target.closest("[data-card-chart]");
  if (ch) { openTickerChart(ch.dataset.cardChart); return; }
  const op = e.target.closest("[data-card-opt]");
  if (op) { openOptionsModal(op.dataset.cardOpt); return; }
});


/* v198 — interruttore compatta/completa */
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-vista]");
  if (!b) return;
  const tid = b.dataset.t;
  if (b.dataset.vista === "completa") saveColHidden(tid, new Set());
  else {
    const head = document.querySelector(`#${tid} thead tr`);
    const vis = new Set(VISTA_COMPATTA[tid] || []);
    saveColHidden(tid, new Set([...head.children].map((_, i) => i).filter(i => !vis.has(i))));
  }
  (tid === "ptf-table" ? renderTable : renderWatchlist)();
});

/* ═══ v199 — SCHEDE. Portafoglio, watchlist, macro e rischio sono quattro MOMENTI diversi:
   impilarli in una pagina sola costringeva a scorrere per trovare cio' che serviva, ed e' una
   delle ragioni per cui la dashboard risultava confusionaria. Le schede non nascondono dati —
   cambiano quale sta davanti. La scelta si ricorda fra le sessioni.
   ⚠ Le sezioni SENZA data-pane restano SEMPRE visibili (avvisi, barra di stato, coda decisioni):
   un contenitore nuovo che nessuno ha marcato non deve sparire per omissione. */
const TAB_KEY = "pref_tab";
/* v222 — UNA PAGINA SOLA. "porta tutto sulla index principale": le schede nascondevano tre
   quarti della dashboard dietro un clic, e per quattro versioni ho creduto di aver spostato
   cose che non si vedevano solo perche' stavano in un pannello chiuso. Ora TUTTO e' in pagina,
   sempre: la barra laterale non commuta piu' niente, porta il punto — e' un indice, e si
   evidenzia da sola sulla sezione che stai guardando. Zero contenuti nascosti. */
/* v223 — la barra laterale torna a COMMUTARE ("solo cliccando nelle voci della barra a
   sinistra posso passare da una sezione all'altra"). In v222 era tutto in pagina e si
   scorreva: troppo lungo. Una sezione per volta, e il clic e' l'unico modo di cambiarla. */
function setTab(nome) {
  const valide = [...document.querySelectorAll("#main-tabs .tab")].map(b => b.dataset.tab);
  if (!valide.includes(nome)) nome = valide[0] || "struttura";
  try { localStorage.setItem(TAB_KEY, nome); } catch { /* quota */ }
  document.querySelectorAll("#main-tabs .tab").forEach(b =>
    b.classList.toggle("tab-active", b.dataset.tab === nome));
  document.querySelectorAll("[data-pane]").forEach(el => { el.hidden = el.dataset.pane !== nome; });
  window.scrollTo?.({ top: 0, behavior: "auto" });   // ?. — l'harness dei test non ha scrollTo
  if (typeof DATA !== "undefined" && DATA) {
    if (nome === "portafoglio") renderTable();
    if (nome === "watchlist") renderWatchlist();
    if (nome === "struttura") { renderStruttura(); renderMacroGrafici(); }
  }
}



document.querySelectorAll("#main-tabs .tab").forEach(b =>
  b.addEventListener("click", () => setTab(b.dataset.tab)));

/* v205 — la scheda d'ingresso diventa STRUTTURA: il flusso previsto è "colpo d'occhio sulla
   struttura → copia il prompt → LLM con accesso web". Si applica UNA SOLA VOLTA e mai sopra
   una preferenza già espressa: la scheda su cui l'utente si è fermato l'ultima volta vince
   (stessa regola della vista compatta di v198 — un default non sovrascrive una scelta). */
/* v222 — tutte le sezioni visibili dal primo istante, nessun ripristino di scheda e nessuno
   scroll automatico all'avvio: la pagina si apre dalla cima e mostra tutto. */
try { setTab(localStorage.getItem(TAB_KEY) || "struttura"); } catch { setTab("struttura"); }
