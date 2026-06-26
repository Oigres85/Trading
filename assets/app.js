/* Trading Dashboard — rendering lato client di data/data.json */
const REPO = "Oigres85/Trading";
let DATA = null;
let sparkRange = "m1";   // 1G | 1M | 1A

/* ordinamento tabelle: click su intestazione → desc → asc → default */
const SORT_FIELDS = {
  // allineato 1:1 alle <th>: Titolo,Qtà,PMC,Prezzo,Oggi,Pre/After,Volume,Guadagno,Guad.%,
  // P/E,EPS,Beta,Sharpe 1A,Supporto,Resistenza,RSI,Vol/media,RS 1M,Segnale,Rating,Target Δ,
  // Financial Health,Short %,Drawdown 52S,Opzioni,Grafico
  "ptf-table": ["name", "qty", "pmc", "price", "change_pct", "prepost_chg", "volume",
                "gain", "gain_pct", "pe", "eps", "beta", "sharpe_1y", "support",
                "resistance", "rsi", "vol_ratio", "rs_1m", null, "upside_pct", "upside_pct",
                "fin_health", "stat:short_float", "w52_dist_pct", null, null],
  // Titolo,Prezzo,Oggi,Pre/After,Volume,P/E,EPS,Beta,Sharpe 1A,Supporto,Resistenza,RSI,
  // Vol/media,RS 1M,Segnale,Rating,Target Δ,Financial Health,Short %,Drawdown 52S,Opzioni,Grafico
  "wl-table": ["name", "price", "change_pct", "prepost_chg", "volume", "pe", "eps",
               "beta", "sharpe_1y", "support", "resistance", "rsi", "vol_ratio",
               "rs_1m", null, "upside_pct", "upside_pct", "fin_health",
               "stat:short_float", "w52_dist_pct", null, null],
  // tabelle fondamentali (vista Value); i campi "stat:" leggono da r.stats
  "ptf-fund-table": ["name", "qty", "pmc", "price", "stat:market_cap", "stat:ev_ebitda",
                     "stat:roe", "stat:gross_margin", "stat:profit_margin", "pfcf",
                     "stat:revenue_growth", "stat:dividend_yield", "stat:price_to_book", "stat:peg"],
  "wl-fund-table": ["name", "price", "stat:market_cap", "stat:ev_ebitda",
                    "stat:roe", "stat:gross_margin", "stat:profit_margin", "pfcf",
                    "stat:revenue_growth", "stat:dividend_yield", "stat:price_to_book", "stat:peg"],
};
const sortState = {
  "ptf-table": { field: null, dir: 0 }, "wl-table": { field: null, dir: 0 },
  "ptf-fund-table": { field: null, dir: 0 }, "wl-fund-table": { field: null, dir: 0 },
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
    const f = SORT_FIELDS[tableId][i];
    if (f && f === field && dir) {
      const s = document.createElement("span");
      s.className = "sort-arrow";
      s.textContent = dir === 1 ? " ▼" : " ▲";
      th.appendChild(s);
    }
  });
}

function initSorting(tableId, rerender) {
  document.querySelectorAll(`#${tableId} thead th`).forEach((th, i) => {
    const f = SORT_FIELDS[tableId][i];
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
    DATA = await fetchData();
    mergeManualHoldings();        // reintegra le posizioni aggiunte a mano (localStorage)
    renderAll();
    livePrices();
    if (showSpin) toast("Dati ricaricati ✓");
  } catch (e) {
    console.error(e);
    if (showSpin) toast("Errore nel caricamento dati");
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
      const d = await fetchData();
      if (d.updated_at !== prev) { DATA = d; renderAll(); return true; }
    } catch { /* riprova */ }
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
function showRefreshProgress() {
  hideRefreshProgress();
  const el = document.createElement("div");
  el.id = "refresh-progress";
  el.className = "refresh-progress";
  el.innerHTML = `
    <div class="rp-row"><span class="rp-spin"></span><span class="rp-msg" id="rp-msg">Avvio aggiornamento…</span><span class="rp-pct" id="rp-pct">0%</span></div>
    <div class="rp-track"><div class="rp-fill" id="rp-fill" style="width:0%"></div></div>`;
  document.body.appendChild(el);
  const start = Date.now();
  const EST = 150000;   // stima ~2,5 minuti
  _refreshTimer = setInterval(() => {
    const pct = Math.min(92, ((Date.now() - start) / EST) * 92);
    const stage = [...REFRESH_STAGES].reverse().find(s => pct >= s[0]) || REFRESH_STAGES[0];
    setRefreshProgress(pct, stage[1]);
  }, 500);
}
function setRefreshProgress(pct, msg) {
  const f = document.getElementById("rp-fill"); if (f) f.style.width = pct.toFixed(0) + "%";
  const p = document.getElementById("rp-pct"); if (p) p.textContent = Math.round(pct) + "%";
  if (msg) { const m = document.getElementById("rp-msg"); if (m) m.textContent = msg; }
}
function finishRefreshProgress(ok) {
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
  setRefreshProgress(100, ok ? "Aggiornamento completato ✓" : "Tempo scaduto — i dati potrebbero arrivare a breve");
  setTimeout(hideRefreshProgress, ok ? 1200 : 2500);
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
    if (res.status !== 204) { toast(`Errore avvio aggiornamento (HTTP ${res.status})`); return; }
    showRefreshProgress();
    waitForNewData(DATA?.updated_at).then(ok => {
      finishRefreshProgress(ok);
      const b2 = $("#btn-refresh");
      const origTxt = "⟳ Aggiorna";
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
    btn.textContent = "⟳ Aggiorna";
  }
}

/* ---------------- aggiungi/rimuovi titoli ---------------- */
const editMode = { portfolio: false, watchlist: false };

async function editHoldings(section, mutate) {
  const token = getToken();
  if (!token) { toast("Serve un token GitHub (permessi Actions + Contents) per modificare le posizioni"); return; }
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
    if (!mutate(cfg)) return;                 // mutate ritorna false se annullato/invalido
    // 2) scrivi il nuovo config
    const body = {
      message: `Aggiorna posizioni (${section})`,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(cfg, null, 1)))),
      sha: file.sha,
    };
    const put = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
      method: "PUT", headers: ghHeaders(token), body: JSON.stringify(body),
    });
    if (!put.ok) { toast(`Errore salvataggio (HTTP ${put.status})`); return; }
    // 3) rigenera i dati in background (NON blocca la UI: la modifica è già visibile)
    dispatchWorkflow(token).catch(() => {});
    toast("Salvato ✓ — dati completi tra ~2-3 min");
    waitForNewData(DATA?.updated_at).then(ok => { if (ok) toast("Dati aggiornati ✓"); });
  } catch (e) {
    console.error(e);
    toast("Errore durante il salvataggio della modifica");
  }
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
}
function removeManualHolding(ticker) {
  localStorage.setItem("manual_holdings",
    JSON.stringify(loadManualHoldings().filter(x => x.ticker !== ticker)));
}
/* unisce le posizioni manuali al DATA.portfolio appena caricato da data.json */
function mergeManualHoldings() {
  try {
    const manual = loadManualHoldings();
    if (!manual.length || !DATA || !Array.isArray(DATA.portfolio)) return;
    let added = false;
    manual.forEach(h => {
      if (DATA.portfolio.some(p => p.ticker === h.ticker)) {
        // la pipeline l'ha già acquisita: pulisci il localStorage
        removeManualHolding(h.ticker);
        return;
      }
      const row = placeholderRow(h.ticker, h.currency || "USD", { qty: h.qty, pmc: h.pmc, name: h.name || h.ticker });
      // inserisci prima del BTP se presente, altrimenti in coda
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
    if (r.bval != null) { v = r.bval; g = r.bgain || 0; }
    else if (r.currency === "EUR") { v = r.value || 0; g = r.gain || 0; }
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
  });
  DATA.allocation = DATA.portfolio.map(r => ({
    ticker: r.ticker, name: r.name, sector: r.sector || "Altro", value_eur: r.val_eur,
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
  renderKPI(); renderTable(); renderWatchlist(); renderAllocation();
  const el = $("#live-badge");
  if (el) el.textContent = `prezzi aggiornati alle ${new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;
}

function renderAll() {
  const d = new Date(DATA.updated_at);
  $("#updated-at").textContent = d.toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" });
  recomputeTotals();            // include la liquidità nei totali/allocazione
  renderCash();
  renderKPI();
  renderHistory();
  renderAllocation();
  renderEarnings();
  renderTable();
  if (ptfView === "fund") renderFundTable();
  renderWatchlist();
  if (wlView === "fund") renderWlFundTable();
  renderGauges();
  renderMacro();
  renderPortfolioHealth();
  renderMiniCards();
  renderTopCaps();
  renderTopETFs();
  renderNews();
  renderBtpInfo();
  renderSellCalc();
  pmcInit();
}

/* ---------------- liquidità (cash) ---------------- */
function renderCash() {
  const inp = $("#cash-input");
  if (inp && document.activeElement !== inp) inp.value = cashEur || "";
  const note = $("#cash-note");
  if (note) note.textContent = cashEur > 0 ? `inclusa nel totale e nell'allocazione (${fmtEUR.format(cashEur)})` : "";
  renderCashDrag();
}

/* Cash Drag: quantifica l'impatto della liquidità infruttifera (0%) sul CAGR obiettivo €1M.
   Se la cassa è una frazione c del patrimonio, la quota investita (1-c) deve rendere
   g/(1-c) per compensare lo 0% della liquidità e mantenere il CAGR complessivo g. */
function renderCashDrag() {
  const box = $("#cash-drag");
  if (!box) return;
  const GOAL = 1_000_000;
  const controvalore = (DATA?.totals || {}).eur_invested || 0;
  const patrimonio = controvalore + cashEur;
  if (!(cashEur > 0) || patrimonio <= 0 || patrimonio >= GOAL) { box.hidden = true; return; }
  const g = (Math.pow(GOAL / patrimonio, 1 / 10) - 1) * 100;   // CAGR complessivo necessario
  const c = cashEur / patrimonio;                               // frazione liquidità
  const cashPct = c * 100;
  const investedPct = (1 - c) * 100;
  const rInvested = g / (1 - c);                                // rendimento richiesto sulla sola quota investita
  const drag = rInvested - g;                                   // peso aggiuntivo dovuto al cash
  const col = drag > 4 ? "var(--red)" : drag > 2 ? "var(--yellow)" : "var(--green)";
  box.hidden = false;
  box.innerHTML = `
    <div class="cash-drag-head"><b>Cash Drag</b> <span class="muted">impatto liquidità a 0% sul CAGR obiettivo</span></div>
    <div class="cash-drag-body">
      La liquidità è il <b>${cashPct.toFixed(1)}%</b> del patrimonio e rende <b>0%</b>.
      Per restare sulla traiettoria del milione (CAGR complessivo <b>${g.toFixed(1)}%</b>),
      la sola quota investita (<b>${investedPct.toFixed(1)}%</b>) deve rendere
      <b style="color:${col}">${rInvested.toFixed(1)}%</b> annuo —
      un sovraccarico di <b style="color:${col}">+${drag.toFixed(1)} pp</b> dovuto al cash.
    </div>`;
}
function saveCash() {
  cashEur = parseFloat($("#cash-input").value) || 0;
  localStorage.setItem("cash_eur", cashEur);
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
      ${compactSemiGauge(100 - sp.pct, ["Ribassista", "Solido"])}
      <div class="mc-value" style="color:${scoreColor(100 - sp.pct)}">${sp.active}/${sp.total} attivi · ${risk}</div>
      <div class="mc-sub muted">clicca per il dettaglio dei 10 segnali</div>`;
  }
  // Rotazione settoriale (Tilt): settore leader (overweight) e fanalino
  const tilt = m.tilt, tBox = $("#tilt-box");
  if (tBox && tilt && tilt.length) {
    const sorted = [...tilt].sort((a, b) => b.m1 - a.m1);
    const maxAbs = Math.max(...sorted.map(s => Math.abs(s.m1)), 1);
    const defensives = ["Utilities", "Consumi difens.", "Salute", "Oro"];
    const defAvg = avg(tilt.filter(s => defensives.includes(s.name)).map(s => s.m1));
    const tech = tilt.find(s => s.ticker === "XLK");
    const regime = (defAvg != null && tech)
      ? (defAvg > tech.m1 ? "Rotazione DIFENSIVA" : "Regime PRO-RISCHIO") : "";
    const regimeCol = (defAvg != null && tech)
      ? (defAvg > tech.m1 ? "var(--yellow)" : "var(--green)") : "var(--muted)";
    const miniHist = sorted.slice(0, 6).map(s => {
      const w = Math.round(Math.abs(s.m1) / maxAbs * 100);
      const col = s.m1 >= 0 ? "var(--green)" : "var(--red)";
      return `<div class="tilt-mini-row">
        <span class="tilt-mini-lab">${s.name.split(" ")[0]}</span>
        <span class="tilt-mini-bar"><span style="width:${w}%;background:${col}"></span></span>
        <span class="tilt-mini-val" style="color:${col}">${s.m1 > 0 ? "+" : ""}${s.m1}%</span>
      </div>`;
    }).join("");
    tBox.innerHTML = `<div class="mc-title">Rotazione settoriale USA</div>
      ${regime ? `<div style="font-size:10.5px;font-weight:700;color:${regimeCol};margin:2px 0 4px">${regime}</div>` : ""}
      <div class="tilt-mini">${miniHist}</div>`;
  }
  // Quadruple Witching (4 streghe): ora mostrata nel popup del box Put/Call (vedi openMacroInfo "putcall")
  // MacroQuant (stile BCA)
  const mq = m.macroquant, mqBox = $("#macroquant-box");
  if (mqBox && mq) {
    const mqLab = mq.score >= 60 ? "Ciclo espansivo" : mq.score >= 40 ? "Ciclo neutro" : "Rischio recessione";
    mqBox.innerHTML = `<div class="mc-title">MacroQuant (Ciclo)</div>
      ${compactSemiGauge(mq.score, ["Recessione", "Crescita"])}
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
      ${compactSemiGauge(se.score, ["Sfavorevole", "Favorevole"])}
      <div class="mc-value" style="color:${scoreColor(se.score)}">${se.score}% · ${se.label}</div>
      <div class="mc-sub muted">${sub}</div>`;
  }
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
  const parts = portfolioHealthParts();
  box.innerHTML = `<span class="popup-dot"></span>
    <div class="hb-left">
      <div class="hb-title">Salute del portafoglio</div>
      <div class="hb-score" style="color:${scoreColor(score)}">${score}/100 · <b>${lab}</b></div>
      <div class="hb-sub muted">media di tecnica titoli + macro/mercato + fondamentale</div>
    </div>
    <div class="hb-right">${compactSemiGauge(score, ["Solido", "Fragile"])}
      <div class="hb-parts">${parts.map(p => `<span>${esc(p[0])}: <b style="color:${scoreColor(p[1])}">${p[1]}</b></span>`).join("")}</div>
    </div>`;
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
     <div class="info-line muted" style="font-size:11px;margin-top:8px">Usa "Copia prompt AI" per il piano operativo dettagliato di rotazione/de-risking con indicazioni precise per ogni posizione.</div>`);
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
    <div class="info-line muted" style="font-size:11px;margin-top:8px">Per il piano operativo dettagliato di rotazione/de-risking usa "Copia prompt AI".</div>`);
}

function openWitchingModal() {
  const w = (DATA.macro || {}).witching;
  if (!w) return;
  const dates = (w.upcoming || []).map(d => `<tr><td>${new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" })}</td><td class="muted">3° venerdì del trimestre</td></tr>`).join("");
  const contracts = (w.contracts || []).map(c => `<li>${esc(c)}</li>`).join("");
  // urgency derivata dai giorni
  const urgency = Math.max(0, Math.min(100, Math.round((1 - w.days / 90) * 100)));
  const urgCol = w.days <= 7 ? "var(--red)" : w.days <= 21 ? "var(--yellow)" : "var(--muted)";
  const urgLab = w.days <= 7 ? "IMMINENTE — massima attenzione a spike di volatilità intraday"
               : w.days <= 21 ? "VICINA — monitorare volumi opzioni e livelli Max Pain"
               : w.days <= 45 ? "IN ARRIVO — posizionarsi in anticipo se necessario"
               : "LONTANA — nessuna azione urgente";
  openInfoModal("Quadruple Witching — le quattro streghe",
    `<p class="muted" style="margin:0 0 8px">Quattro volte l'anno (3° venerdì di marzo, giugno, settembre, dicembre) scadono contemporaneamente quattro tipi di derivati: spesso aumentano volumi e volatilità del 30-50% rispetto alla media giornaliera.</p>
     <div class="info-line"><b>Prossima:</b> <b style="color:${urgCol}">${w.next ? new Date(w.next).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }) : "—"}</b> (tra ${w.days} giorni)</div>
     <div class="meter-track" style="margin:6px 0"><span class="meter-fill" style="width:${urgency}%;background:${urgCol}"></span></div>
     <div class="info-line" style="color:${urgCol};font-size:12px;margin-bottom:10px">${urgLab}</div>
     <div class="info-line muted" style="font-size:11px;margin-bottom:6px">In prossimità della scadenza i market maker coprono/chiudono le posizioni → volumi straordinari attorno a Call Wall e Put Wall (vedi sezione <b>Put/Call</b> per i muri di opzioni del tuo portafoglio), spesso con "pinning" del prezzo ai livelli di maggiore open interest.</div>
     <h4 style="margin:10px 0 4px">Prossime date</h4>
     <table class="info-table"><thead><tr><th>Data</th><th>Note</th></tr></thead><tbody>${dates}</tbody></table>
     <h4 style="margin:10px 0 4px">Contratti in scadenza</h4><ul style="margin:0 0 0 18px">${contracts}</ul>
     <div class="info-line muted" style="font-size:11px;margin-top:10px">Strategia tipica: evitare posizioni aperte sul mercato USA nelle 2 ore finali del giorno di scadenza. Se si detengono opzioni in portafoglio, valutare chiusura 1-2 giorni prima.</div>`);
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
  // Daily Tracking Error vs benchmark (oggi): portafoglio Day % − indice principale
  // (differenza aritmetica intraday, non un alpha corretto per il rischio su base storica)
  const bm = (DATA.macro || {}).benchmarks;
  if (bm) {
    const pday = portfolioDayPct();
    const ref = bm.sp500 != null ? "sp500" : bm.ndx != null ? "ndx" : "sox";
    const refLab = { sp500: "S&P 500", ndx: "Nasdaq 100", sox: "SOX" }[ref];
    const alpha = (pday != null && bm[ref] != null) ? pday - bm[ref] : null;
    kpis.push({
      label: "Daily Tracking Error vs " + refLab,
      value: alpha != null ? signTxt(Math.round(alpha * 100) / 100) + " pp" : "—",
      sub: `portaf. ${pday != null ? signTxt(Math.round(pday * 100) / 100) : "—"} · clicca per S&P/Nasdaq/SOX`,
      accent: "var(--cyan)", valueCls: signCls(alpha), kpiKey: "alpha",
    });
  }
  // Sharpe Ratio complessivo del portafoglio (rendimento corretto per il rischio)
  const pSharpe = t.portfolio_sharpe_ratio;
  if (pSharpe != null) {
    kpis.push({
      label: "Sharpe Ratio portafoglio",
      value: fmtNum.format(pSharpe),
      sub: pSharpe > 2 ? "eccellente · rendimento/rischio efficiente"
        : pSharpe >= 1 ? "buono · qualità istituzionale"
        : pSharpe >= 0 ? "debole · poco premio per la volatilità"
        : "negativo · rischio non ripagato",
      accent: sharpeColor(pSharpe), valueCls: "",
      valueStyle: `color:${sharpeColor(pSharpe)}`,
    });
  }

  $("#kpi-grid").innerHTML = kpis.map(k => `
    <div class="kpi${k.kpiKey ? " kpi-click" : ""}" style="--accent:${k.accent}"${k.kpiKey ? ` data-kpi="${k.kpiKey}" role="button" tabindex="0" title="Clicca per il dettaglio"` : ""}>
      <div class="label">${k.label}</div>
      <div class="value ${k.valueCls || ""}"${k.valueStyle ? ` style="${k.valueStyle}"` : ""}>${k.value}</div>
      <div class="sub ${k.subCls || ""}">${k.sub || ""}</div>
    </div>`).join("");

  // MilioneTracker — obiettivo €1.000.000 in 10 anni
  const GOAL = 1_000_000;
  const completionPct = Math.min(100, patrimonio / GOAL * 100);
  const cagrNeeded = patrimonio > 0 && patrimonio < GOAL
    ? (Math.pow(GOAL / patrimonio, 1 / 10) - 1) * 100 : 0;
  const distanza = GOAL - patrimonio;
  const cagrCol = cagrNeeded <= 10 ? "var(--green)" : cagrNeeded <= 15 ? "var(--yellow)" : "var(--red)";
  const cagrRisk = cagrNeeded <= 10 ? "raggiungibile (Nasdaq storico ~10-12%)" : cagrNeeded <= 15 ? "sfidante ma realistico con tech" : "richiede performance eccezionale";
  const goalYear = new Date().getFullYear() + 10;
  const gradPct = Math.round(completionPct);
  const mt = document.getElementById("milione-tracker");
  if (mt) {
    mt.innerHTML = `
      <div class="mt-header">
        <span class="mt-title">MilioneTracker</span>
        <span class="mt-goal">Obiettivo: €1.000.000 entro ${goalYear}</span>
      </div>
      <div class="mt-row">
        <span class="mt-stat"><span class="mt-val">${completionPct.toFixed(1)}%</span><span class="mt-lab">completato</span></span>
        <span class="mt-stat mt-cagr-btn" role="button" tabindex="0" title="Clicca per la spiegazione del CAGR necessario">
          <span class="mt-val" style="color:${cagrCol}">${cagrNeeded.toFixed(1)}%</span>
          <span class="mt-lab">CAGR/anno <span class="mt-help">?</span></span>
        </span>
        <span class="mt-stat"><span class="mt-val muted">${fmtEUR.format(Math.round(Math.max(0, distanza)))}</span><span class="mt-lab">mancano</span></span>
      </div>
      <div class="mt-bar-track">
        <div class="mt-bar-fill" style="width:${gradPct}%"></div>
        <span class="mt-bar-label">${gradPct}%</span>
      </div>
      <div class="mt-note muted">CAGR ${cagrNeeded.toFixed(1)}%/anno: ${cagrRisk} — <span class="mt-cagr-link">cos'è?</span></div>`;
    const openCagr = () => openCagrInfo(patrimonio, GOAL, cagrNeeded, completionPct, distanza, goalYear, cagrRisk);
    mt.querySelector(".mt-cagr-btn")?.addEventListener("click", openCagr);
    mt.querySelector(".mt-cagr-btn")?.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCagr(); } });
    mt.querySelector(".mt-cagr-link")?.addEventListener("click", openCagr);
  }
}

/* Spiegazione del CAGR necessario per l'obiettivo €1M (popup) */
function openCagrInfo(patrimonio, GOAL, cagrNeeded, completionPct, distanza, goalYear, cagrRisk) {
  const yrs = 10;
  // tabella di proiezione anno per anno al CAGR necessario
  const rows = [];
  let v = patrimonio;
  const nowYear = new Date().getFullYear();
  for (let i = 1; i <= yrs; i++) {
    v = v * (1 + cagrNeeded / 100);
    rows.push(`<tr><td>${nowYear + i}</td><td class="num">${fmtEUR.format(Math.round(v))}</td><td class="num muted">${signTxt(Math.round(cagrNeeded * 10) / 10)}</td></tr>`);
  }
  // scenari di confronto: cosa succede a CAGR diversi
  const scenario = (rate) => fmtEUR.format(Math.round(patrimonio * Math.pow(1 + rate / 100, yrs)));
  const riskCol = cagrNeeded <= 10 ? "var(--green)" : cagrNeeded <= 15 ? "var(--yellow)" : "var(--red)";
  openInfoModal("CAGR necessario — cosa significa",
    `<div class="info-line" style="margin-bottom:10px"><b>CAGR</b> = <b>C</b>ompound <b>A</b>nnual <b>G</b>rowth <b>R</b>ate, il <b>tasso di crescita annuo composto</b>. È la percentuale di cui il tuo patrimonio deve crescere <b>ogni anno</b> (reinvestendo i guadagni) per passare da ${fmtEUR.format(Math.round(patrimonio))} a €1.000.000 in ${yrs} anni.</div>
     <div class="info-line" style="background:var(--card-2);border-radius:8px;padding:10px;margin-bottom:10px">
       <div style="font-size:13px;margin-bottom:4px">Il tuo obiettivo richiede: <b style="color:${riskCol};font-size:18px">${cagrNeeded.toFixed(1)}% / anno</b></div>
       <div class="muted" style="font-size:12px">Patrimonio attuale ${fmtEUR.format(Math.round(patrimonio))} (${completionPct.toFixed(1)}% del milione) · mancano ${fmtEUR.format(Math.round(Math.max(0, distanza)))} · traguardo ${goalYear}</div>
       <div style="font-size:12px;margin-top:6px;color:${riskCol}">Valutazione: <b>${cagrRisk}</b></div>
     </div>
     <h4 style="margin:8px 0 4px">Come si calcola</h4>
     <div class="info-line muted" style="font-size:12px;margin-bottom:8px">CAGR = (Obiettivo ÷ Patrimonio)<sup>1/anni</sup> − 1 = (1.000.000 ÷ ${Math.round(patrimonio)})<sup>1/${yrs}</sup> − 1 = <b>${cagrNeeded.toFixed(1)}%</b>. Non è la crescita totale divisa per 10: l'interesse composto fa sì che ogni anno cresca anche sui guadagni degli anni precedenti.</div>
     <h4 style="margin:10px 0 4px">Proiezione al ${cagrNeeded.toFixed(1)}% annuo</h4>
     <table class="info-table"><thead><tr><th>Anno</th><th class="num">Patrimonio proiettato</th><th class="num">Crescita</th></tr></thead><tbody>${rows.join("")}</tbody></table>
     <h4 style="margin:10px 0 4px">Confronto: dove arrivi in ${yrs} anni a tassi diversi</h4>
     <table class="info-table"><thead><tr><th>CAGR</th><th class="num">Risultato</th><th>Riferimento</th></tr></thead><tbody>
       <tr><td>7%</td><td class="num">${scenario(7)}</td><td class="muted">S&P 500 storico (reale)</td></tr>
       <tr><td>10%</td><td class="num">${scenario(10)}</td><td class="muted">S&P 500 storico (nominale)</td></tr>
       <tr><td>13%</td><td class="num">${scenario(13)}</td><td class="muted">Nasdaq 100 ~media lungo periodo</td></tr>
       <tr style="background:rgba(245,158,11,.10)"><td><b>${cagrNeeded.toFixed(1)}%</b></td><td class="num"><b>${scenario(cagrNeeded)}</b></td><td><b>il tuo obiettivo</b></td></tr>
       <tr><td>20%</td><td class="num">${scenario(20)}</td><td class="muted">performance eccezionale/rischiosa</td></tr>
     </tbody></table>
     <div class="info-line muted" style="font-size:11px;margin-top:8px">Più alto è il CAGR necessario, più rischio devi assumere. Sopra ~15% annuo l'obiettivo richiede concentrazione su asset ad alta crescita (tech/semi) e tolleranza ai drawdown — coerente col mandato Diamond Hands. Aumentare la liquidità investita o allungare l'orizzonte temporale abbassa il CAGR richiesto.</div>`);
}

function openBetaSimulator() {
  const GOAL = 1_000_000;
  const t = DATA.totals;
  const patrimonio = t.eur_invested + cashEur;
  const eurusd = DATA.eurusd || 1.08;
  const holdings = (DATA.portfolio || []).filter(r => r.beta != null && (r.val_eur || r.value));
  if (!holdings.length) { toast("Beta non disponibile per il portafoglio"); return; }
  const totalVal = holdings.reduce((s, r) => s + (r.val_eur || (r.value || 0) / eurusd), 0) || 1;
  const wAvgBeta = holdings.reduce((s, r) => s + r.beta * (r.val_eur || (r.value || 0) / eurusd), 0) / totalVal;
  const scenarios = [-10, -15, -20, -30, -40];
  const rows = scenarios.map(ndxChg => {
    const ptfChg = ndxChg * wAvgBeta;
    const ptfAfter = patrimonio * (1 + ptfChg / 100);
    const dist = ptfAfter - GOAL;
    const distPct = (ptfAfter / GOAL - 1) * 100;
    const col = ptfAfter >= GOAL * 0.9 ? "var(--green)" : ptfAfter >= GOAL * 0.7 ? "var(--yellow)" : "var(--red)";
    return `<tr>
      <td class="num neg">Nasdaq ${ndxChg}%</td>
      <td class="num neg">${signTxt(Math.round(ptfChg * 10) / 10)}</td>
      <td class="num" style="color:${col}">${fmtEUR.format(Math.round(ptfAfter))}</td>
      <td class="num ${signCls(dist)}">${signTxt(Math.round(dist), " €")}</td>
      <td class="num ${signCls(distPct)}">${signTxt(Math.round(distPct * 10) / 10)}</td>
    </tr>`;
  }).join("");
  const tkBetas = holdings.slice().sort((a, b) => b.beta - a.beta).map(r =>
    `<span>${r.ticker} <b style="color:${scoreColor(clamp(100-(r.beta-0.5)*55))}">${fmtNum.format(r.beta)}</b></span>`).join(" · ");
  openInfoModal("Beta — Simulatore Drawdown Portafoglio", `
    <div class="info-line muted" style="font-size:11.5px;margin-bottom:8px">Simulazione dell'impatto sul portafoglio al variare del Nasdaq. Il drawdown stimato = variazione Nasdaq × Beta ponderato del portafoglio. L'obiettivo finale è <b style="color:var(--green)">€1.000.000</b>.</div>
    <div class="info-line"><b>Beta ponderato portafoglio:</b> <b style="font-family:var(--mono)">${fmtNum.format(Math.round(wAvgBeta * 100) / 100)}</b></div>
    <div class="info-line"><b>Patrimonio attuale:</b> ${fmtEUR.format(Math.round(patrimonio))}</div>
    <div class="info-line muted" style="font-size:11px;margin-bottom:10px">Beta per titolo: ${tkBetas}</div>
    <table class="info-table"><thead><tr><th>Scenario Nasdaq</th><th>Drawdown stim.</th><th>Patrimonio risultante</th><th>Distanza da €1M</th><th>Δ obiettivo %</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="info-line muted" style="font-size:11px;margin-top:8px">Formula: Drawdown portafoglio = Δ% Nasdaq × Beta ponderato. Non considera ribilanciamento, stop loss o coperture. Il patrimonio include liquidità (${fmtEUR.format(cashEur)}).</div>`);
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

function renderHistory() {
  let h = DATA.history && DATA.history[histRange];
  // vista Max = storico completo: andamento precedente (pipeline, dal 2021) raccordato
  // alla curva REALE del broker degli ultimi mesi (ultimo punto = controvalore reale)
  const ec = DATA.broker?.equity_curve;
  let realCurve = false;
  if (histRange === "all" && ec && ec.length > 1) {
    const all = DATA.history?.all;
    const cut = ec[0].d;
    let oldDates = [], oldVals = [];
    if (all?.dates?.length) {
      for (let i = 0; i < all.dates.length; i++) {
        if (all.dates[i] < cut) { oldDates.push(all.dates[i]); oldVals.push(all.values[i]); }
      }
      if (oldVals.length) {   // raccordo: scala lo storico precedente per agganciarlo al 1° punto reale
        const f = ec[0].v / oldVals[oldVals.length - 1];
        oldVals = oldVals.map(v => Math.round(v * f));
      }
    }
    const stDates = oldDates.concat(ec.map(p => p.d));
    const stVals = oldVals.concat(ec.map(p => p.v));
    h = { dates: stDates, values: stVals };
    // benchmark sovrapposto. Preferito: serie indice ALLINEATA alle date reali del broker
    // (broker_bench, generata dalla pipeline) — corretta anche per IPO recenti che accorciano
    // la storia del portafoglio. Fallback: campionamento per data vicina sulla serie "all".
    const bb = DATA.history?.broker_bench;
    const bbUsable = bb && !oldVals.length && Array.isArray(bb.dates) && bb.dates.length === ec.length;
    if (bbUsable) {
      ["nasdaq", "ndx", "sp500", "russell"].forEach(bk => {
        if (Array.isArray(bb[bk]) && bb[bk].length === stVals.length) h[bk] = bb[bk];
      });
    } else if (all?.dates?.length) {
      const allT = all.dates.map(d => +new Date(d));
      ["nasdaq", "ndx", "sp500", "russell"].forEach(bk => {
        const ser = all[bk];
        if (!ser || ser.length !== all.dates.length) return;
        const sampled = stDates.map(d => {
          const t = +new Date(d);
          let bi = 0, best = Infinity;
          for (let i = 0; i < allT.length; i++) { const dd = Math.abs(allT[i] - t); if (dd < best) { best = dd; bi = i; } }
          return ser[bi];
        });
        // se il campionamento è quasi tutto piatto (copertura indice < finestra), non mostrare l'overlay fuorviante
        const distinct = new Set(sampled).size;
        if (sampled[0] && distinct > Math.max(3, sampled.length * 0.3)) {
          const sf = stVals[0] / sampled[0]; h[bk] = sampled.map(v => Math.round(v * sf));
        }
      });
    }
    realCurve = true;
  }
  const box = $("#hist-chart");
  if (!h || h.values.length < 2) { box.innerHTML = '<div class="muted" style="padding:40px 0;text-align:center">Storico non disponibile</div>'; $("#hist-summary").textContent = ""; return; }
  const vals = h.values, dates = h.dates;
  const bench = (histBenchKey !== "none" && h[histBenchKey] && h[histBenchKey].length === vals.length) ? h[histBenchKey] : null;
  const W = 560, H = 210, pad = { l: 56, r: 12, t: 12, b: 22 };
  const allv = bench ? vals.concat(bench) : vals;
  const min = Math.min(...allv), max = Math.max(...allv), range = max - min || 1;
  const x = i => pad.l + i / (vals.length - 1) * (W - pad.l - pad.r);
  const y = v => pad.t + (1 - (v - min) / range) * (H - pad.t - pad.b);
  const poly = arr => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${pad.l},${y(min)} ${poly(vals)} ${x(vals.length - 1)},${y(min)}`;
  const up = vals[vals.length - 1] >= vals[0];
  const col = up ? "var(--green)" : "var(--red)";
  const grid = [0, .25, .5, .75, 1].map(f => {
    const gv = min + range * f, gy = y(gv);
    return `<line x1="${pad.l}" y1="${gy.toFixed(1)}" x2="${W - pad.r}" y2="${gy.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>
      <text x="${pad.l - 6}" y="${(gy + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)">${fmtNum.format(Math.round(gv / 1000))}k</text>`;
  }).join("");
  const xl = [0, Math.floor(vals.length / 2), vals.length - 1].map(i => {
    const dt = new Date(dates[i]).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" });
    return `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--muted)">${dt}</text>`;
  }).join("");
  const benchLine = bench ? `<polyline points="${poly(bench)}" fill="none" stroke="var(--cyan)" stroke-width="1.6" stroke-dasharray="4 3" opacity="0.85"/>` : "";
  box.innerHTML = `<svg id="hist-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:210px">
    <defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${col}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <polygon points="${area}" fill="url(#hg)"/>
    <polyline points="${poly(vals)}" fill="none" stroke="${col}" stroke-width="2"/>
    ${benchLine}
    <line id="hist-cursor" x1="0" y1="${pad.t}" x2="0" y2="${H - pad.b}" stroke="var(--text)" stroke-width="1" opacity="0"/>
    <circle id="hist-dot" r="3.5" fill="${col}" opacity="0"/>
    <rect id="hist-hit" x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent"/>
  </svg>${bench ? `<div class="bench-leg"><span class="leg-dash"></span> ${BENCH_LABEL[histBenchKey]} (riscalato)</div>` : ""}`;
  const first = vals[0], last = vals[vals.length - 1], chg = (last / first - 1) * 100;
  let benchTxt = "", alphaBadge = "";
  if (bench) {
    const bchg = (bench[bench.length - 1] / bench[0] - 1) * 100;
    const alpha = Math.round((chg - bchg) * 10) / 10;
    alphaBadge = ` · <b>Alpha: <span class="${signCls(alpha)}">${signTxt(alpha)} pp</span></b> vs ${BENCH_LABEL[histBenchKey]}`;
    benchTxt = ` · ${BENCH_LABEL[histBenchKey]} <span class="${signCls(bchg)}">${signTxt(Math.round(bchg * 10) / 10)}</span>${alphaBadge}`;
  }
  $("#hist-summary").innerHTML = `<span id="hist-tip">${fmtEUR.format(first)} → <b>${fmtEUR.format(last)}</b>
    <span class="${signCls(chg)}">${signTxt(Math.round(chg * 100) / 100)}</span> nel periodo${benchTxt}</span>`;

  // tooltip al passaggio del mouse
  const svg = $("#hist-svg"), hit = $("#hist-hit"), cursor = $("#hist-cursor"), dot = $("#hist-dot"), tip = $("#hist-tip");
  const baseTip = tip.innerHTML;
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
    const i = Math.max(0, Math.min(vals.length - 1, Math.round((px / r.width * W - pad.l) / (W - pad.l - pad.r) * (vals.length - 1))));
    const vx = x(i), vy = y(vals[i]);
    cursor.setAttribute("x1", vx); cursor.setAttribute("x2", vx); cursor.setAttribute("opacity", ".4");
    dot.setAttribute("cx", vx); dot.setAttribute("cy", vy); dot.setAttribute("opacity", "1");
    const dchg = (vals[i] / first - 1) * 100;
    tip.innerHTML = `${new Date(dates[i]).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}: <b>${fmtEUR.format(vals[i])}</b> <span class="${signCls(dchg)}">${signTxt(Math.round(dchg * 100) / 100)}</span> dal primo giorno`;
  };
  const leave = () => { cursor.setAttribute("opacity", "0"); dot.setAttribute("opacity", "0"); tip.innerHTML = baseTip; };
  hit.addEventListener("mousemove", move);
  hit.addEventListener("touchmove", move);
  hit.addEventListener("mouseleave", leave);
}

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
    src.forEach(x => { const s = x.sector || "Altro"; by[s] = (by[s] || 0) + x.value_eur; });
    list = Object.entries(by).map(([name, value_eur]) => ({ name, ticker: "", value_eur }))
      .sort((a, b) => b.value_eur - a.value_eur);
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
    return `<li class="alloc-item">
      <span class="alloc-dot" style="background:${ALLOC_COLORS[i % ALLOC_COLORS.length]}"></span>
      <span class="alloc-name">${esc(x.name)} ${x.ticker ? `<span class="tk">${x.ticker}</span>` : ""}</span>
      <span class="alloc-pct">${pct}%</span>
      <span class="alloc-val muted">${fmtEUR.format(Math.round(x.value_eur))}</span>
    </li>`;
  }).join("");
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

function rsiBar(rsi) {
  if (rsi === null || rsi === undefined) return "—";
  // ipervenduto (<30) = verde (opportunità) · ipercomprato (>70) = rosso (rischio)
  const color = scoreColor(100 - rsi);
  return meterBar(rsi, color, fmtNum.format(rsi));
}

function volBar(ratio) {
  if (!ratio) return "—";
  // volume vs media 30gg: normale = verde, anomalo = rosso (gradiente)
  return meterBar((ratio / 3) * 100, scoreColor(clamp(100 - (ratio - 1) * 60)), `${fmtNum.format(ratio)}×`);
}

const RATING_LABELS = {
  strong_buy: ["Strong Buy", "good"], buy: ["Buy", "good"],
  hold: ["Hold", "neutral"], underperform: ["Underperf.", "bad"],
  sell: ["Sell", "bad"], strong_sell: ["Strong Sell", "bad"],
};

function ratingBadge(r) {
  if (!r || !r.key) return "—";
  const [label, cls] = RATING_LABELS[r.key] || [r.key, "neutral"];
  const n = r.n ? ` title="${r.n} analisti — target medio ${fmtNum.format(r.target)}"` : "";
  return `<span class="badge ${cls}"${n}>${label}</span>`;
}

function targetBar(r) {
  if (!r || r.upside_pct === null || r.upside_pct === undefined) return "—";
  const u = r.upside_pct;   // upside alto = verde, negativo = rosso
  return meterBar(Math.abs(u) * 2, scoreColor(clamp(50 + u * 2.5)), signTxt(u));
}

function peBar(pe) {
  if (!pe || pe <= 0) return "—";   // P/E basso = verde (economico), alto = rosso
  return meterBar(Math.min(pe, 60) / 60 * 100, scoreColor(clamp(100 - pe * 2.2)), fmtNum.format(pe));
}

function epsBar(eps) {
  if (eps === null || eps === undefined) return "—";   // utili positivi = verde
  return meterBar(Math.min(Math.abs(eps), 15) / 15 * 100, scoreColor(clamp(50 + eps * 6)), fmtNum.format(eps));
}

function betaBar(r) {
  const beta = typeof r === "object" ? r.beta : r;
  const tk = typeof r === "object" ? r.ticker : null;
  if (beta === null || beta === undefined) return "—";
  const bar = meterBar(Math.min(beta, 3) / 3 * 100, scoreColor(clamp(100 - (beta - 0.5) * 55)), fmtNum.format(beta));
  if (!tk) return bar;
  return `<button class="beta-btn" data-beta-tk="${tk}" title="Clicca per simulare il drawdown del portafoglio">${bar}</button>`;
}

function athBar(r) {
  if (!r.ath) return "—";
  const closeness = Math.max(0, 100 + r.ath_dist_pct);   // 100 = sul massimo storico = verde
  return `<div class="meter" title="Max storico ${fmtNum.format(r.ath)}">
    <span class="meter-txt">${signTxt(r.ath_dist_pct)}</span>
    <span class="meter-track"><span class="meter-fill" style="width:${Math.max(3, closeness)}%;background:${scoreColor(closeness)}"></span></span>
  </div>`;
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

function rsBar(rs, bench) {
  if (rs == null) return "—";
  const color = rs >= 2 ? "var(--green)" : rs <= -2 ? "var(--red)" : "var(--muted)";
  const bl = bench === "sox" ? "SOX" : bench === "ndx" ? "NDX" : "S&P";
  const blHtml = bench ? ` <span class="muted" style="font-size:9px;vertical-align:middle">${bl}</span>` : "";
  return `<span class="${rs > 0 ? "pos" : rs < 0 ? "neg" : ""}" style="font-family:var(--mono);font-size:12px;color:${color}">${rs > 0 ? "+" : ""}${fmtNum.format(rs)}%</span>${blHtml}`;
}

/* Popup esplicativo della colonna "RS 1M" (forza relativa vs indice di settore: SOX/NDX/S&P) */
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
  return `<td class="num">${pct}%${squeeze ? `<br><span class="badge badge-squeeze" title="Short Squeeze Risk: short float > 12%">[Squeeze Risk]</span>` : ""}</td>`;
}

function drawdownCell(r) {
  const d = r.w52_dist_pct;
  if (d == null) return `<td class="num muted">—</td>`;
  if (d <= -25) {
    const msg = "Zona DEEP VALUE — considera deploy liquidità 50%+";
    return `<td class="num" title="${msg}"><span class="neg">${signTxt(d)}</span><br><span class="badge badge-deep-value">[DEEP VALUE]</span></td>`;
  }
  if (d <= -15) {
    const msg = "Zona CORREZIONE — considera deploy liquidità 25-30%";
    return `<td class="num" title="${msg}"><span class="neg">${signTxt(d)}</span><br><span class="badge badge-correction">[CORRECTION: Z1]</span></td>`;
  }
  return `<td class="num"><span class="${d < 0 ? "neg" : "pos"}">${signTxt(d)}</span></td>`;
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

function techCells(r) {
  const c = cur(r);
  // supporto/resistenza cambiano con il range selezionato (1S/1M/3M/1A)
  const tw = (r.tech_by_range || {})[sparkRange];
  const support = tw ? tw.support : r.support;
  const resistance = tw ? tw.resistance : r.resistance;
  return `
      <td class="num">${peBar(r.pe)}</td>
      <td class="num">${epsBar(r.eps)}</td>
      <td class="num">${betaBar(r)}</td>
      ${sharpeCell(r)}
      <td class="num">${support ? c + fmtNum.format(support) : "—"}</td>
      <td class="num">${resistance ? c + fmtNum.format(resistance) : "—"}</td>
      <td class="num">${rsiBar(r.rsi)}</td>
      <td class="num">${volBar(r.vol_ratio)}</td>
      <td class="num rs-cell" data-rs-tk="${r.ticker}" role="button" tabindex="0" title="Clicca per la spiegazione della forza relativa (RS)">${rsBar(r.rs_1m, r.rs_bench)}</td>
      <td><span class="badge ${r.signal_class}">${r.signal}</span></td>
      <td>${ratingBadge(r.rating)}</td>
      <td class="num">${targetBar(r.rating)}</td>
      <td class="num">${finHealthBar(r)}</td>
      ${shortFloatCell(r)}
      ${drawdownCell(r)}
      ${optImpactCell(r.ticker)}
      <td class="spark-cell" data-tk="${r.ticker}" title="Clicca per ingrandire">${sparkline((r.sparks || {})[sparkRange])}</td>`;
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
    labels += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3" fill="#f59e0b" opacity="${op}"><title>Margine ${x.year}: ${x.margin}%</title></circle>`;
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
function openChartModal(title, vals, dates, fmt, controlsHTML) {
  if (!vals || vals.length < 2) { toast("Grafico non disponibile per questo intervallo"); return; }
  fmt = fmt || (v => fmtNum.format(v));
  const W = 900, H = 380, pad = { l: 64, r: 16, t: 16, b: 28 };
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
  const x = i => pad.l + i / (vals.length - 1) * (W - pad.l - pad.r);
  const y = v => pad.t + (1 - (v - min) / range) * (H - pad.t - pad.b);
  const line = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = vals[vals.length - 1] >= vals[0], col = up ? "var(--green)" : "var(--red)";
  const grid = [0, .25, .5, .75, 1].map(f => {
    const gv = min + range * f, gy = y(gv);
    return `<line x1="${pad.l}" y1="${gy.toFixed(1)}" x2="${W - pad.r}" y2="${gy.toFixed(1)}" stroke="var(--border)"/>
      <text x="${pad.l - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--muted)">${fmt(gv)}</text>`;
  }).join("");
  $("#chart-modal-title").textContent = title;
  $("#chart-modal-body").innerHTML = (controlsHTML || "") + `<svg id="cm-svg" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    <defs><linearGradient id="cmg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${col}" stop-opacity="0.25"/><stop offset="100%" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <polygon points="${pad.l},${y(min)} ${line} ${x(vals.length - 1)},${y(min)}" fill="url(#cmg)"/>
    <polyline points="${line}" fill="none" stroke="${col}" stroke-width="2.5"/>
    <line id="cm-cur" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--text)" opacity="0"/>
    <circle id="cm-dot" r="4.5" fill="${col}" opacity="0"/>
    <rect id="cm-hit" x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent"/>
  </svg>`;
  const first = vals[0], last = vals[vals.length - 1], chg = (last / first - 1) * 100;
  const baseTip = `${fmt(first)} → ${fmt(last)} · <span class="${signCls(chg)}">${signTxt(Math.round(chg * 100) / 100)}</span> nel periodo`;
  const tip = $("#chart-modal-tip"); tip.innerHTML = baseTip;
  $("#chart-modal").hidden = false;
  const svg = $("#cm-svg"), hit = $("#cm-hit"), cur = $("#cm-cur"), dot = $("#cm-dot");
  const move = ev => {
    const r = svg.getBoundingClientRect();
    const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
    const i = Math.max(0, Math.min(vals.length - 1, Math.round((px / r.width * W - pad.l) / (W - pad.l - pad.r) * (vals.length - 1))));
    cur.setAttribute("x1", x(i)); cur.setAttribute("x2", x(i)); cur.setAttribute("opacity", ".4");
    dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(vals[i])); dot.setAttribute("opacity", "1");
    const d = dates && dates[i] ? new Date(dates[i]).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }) + ": " : "";
    const dchg = (vals[i] / first - 1) * 100;
    tip.innerHTML = `${d}<b>${fmt(vals[i])}</b> <span class="${signCls(dchg)}">${signTxt(Math.round(dchg * 100) / 100)}</span>`;
  };
  hit.addEventListener("mousemove", move);
  hit.addEventListener("touchmove", ev => { ev.preventDefault(); move(ev); }, { passive: false });
  hit.addEventListener("touchstart", move);
}
function closeChartModal() { $("#chart-modal").hidden = true; }

/* zoom del grafico di un singolo titolo, con selettore range e date sul punto */
let cmTicker = null, cmRange = "m1";
const CM_RANGES = [["d1", "1G"], ["w1", "1S"], ["m1", "1M"], ["m3", "3M"], ["m6", "6M"], ["y1", "1A"], ["all", "ALL"]];
const CM_SPAN = { d1: 1, w1: 7, m1: 31, m3: 92, m6: 183, y1: 365, all: 365 * 5 };   // giorni coperti (per le date)

function synthDates(range, n) {
  const span = CM_SPAN[range] || 30, today = Date.now(), out = [];
  for (let i = 0; i < n; i++) out.push(new Date(today - (n - 1 - i) * (span / (n - 1 || 1)) * 86400000).toISOString().slice(0, 10));
  return out;
}

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

function cmControlsHTML(r) {
  const tv = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol(r))}`;
  const ranges = `<div class="spark-toggle cm-ranges">` +
    CM_RANGES.map(([k, lab]) => `<button class="chip cm-range ${k === cmRange ? "chip-active" : ""}" data-range="${k}">${lab}</button>`).join("") +
    `</div>`;
  const views = `<div class="spark-toggle cm-views">
    <button class="chip cm-viewbtn ${cmView === "candles" ? "chip-active" : ""}" data-cmview="candles">Candele</button>
    <button class="chip cm-viewbtn ${cmView === "tv" ? "chip-active" : ""}" data-cmview="tv">TradingView</button>
  </div>`;
  return `<div class="cm-controls">${ranges}${views}<a class="btn btn-ghost btn-sm" href="${tv}" target="_blank" rel="noopener">Apri su TradingView ↗</a></div>`;
}

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

async function drawTickerChart() {
  const all = [...(DATA.portfolio || []), ...(DATA.watchlist || [])];
  const r = all.find(x => x.ticker === cmTicker);
  if (!r) return;
  const sym = r.currency === "PTS" ? "" : r.currency === "EUR" ? "€" : "$";
  const controls = cmControlsHTML(r);
  $("#chart-modal-title").textContent = `${r.name} (${r.ticker})`;
  $("#chart-modal-tip").innerHTML = "";
  $("#chart-modal").hidden = false;
  if (cmView === "tv") {
    $("#chart-modal-body").innerHTML = controls + renderTvWidget(r);
    return;
  }
  $("#chart-modal-body").innerHTML = controls + `<div class="muted" style="padding:40px 0;text-align:center" id="cm-loading">Carico le candele…</div>`;
  const [yr, yi] = CM_YF[cmRange] || ["1mo", "1d"];
  const ohlc = await fetchOHLC(r.ticker, yr, yi);
  if (cmTicker !== r.ticker || cmView !== "candles") return;   // l'utente ha cambiato nel frattempo
  if (ohlc) {
    drawCandleChart(ohlc, v => sym + fmtNum.format(v), controls);
  } else {                                    // fallback: linea dai dati salvati
    const vals = (r.sparks || {})[cmRange];
    openChartModal(`${r.name} (${r.ticker})`, vals, synthDates(cmRange, (vals || []).length), v => sym + fmtNum.format(v), controls);
  }
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
      <td>${o.iv != null ? o.iv.toFixed(1) + "%" : "—"}</td>
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
function drawCandleChart(data, fmt, controlsHTML) {
  const W = 900, H = 380, pad = { l: 64, r: 16, t: 16, b: 28 };
  const lo = Math.min(...data.map(d => d.l)), hi = Math.max(...data.map(d => d.h));
  const range = hi - lo || 1;
  const x = i => pad.l + (i + 0.5) / data.length * (W - pad.l - pad.r);
  const y = v => pad.t + (1 - (v - lo) / range) * (H - pad.t - pad.b);
  const cw = Math.max(1.2, Math.min(14, (W - pad.l - pad.r) / data.length * 0.65));
  const grid = [0, .25, .5, .75, 1].map(f => {
    const gv = lo + range * f, gy = y(gv);
    return `<line x1="${pad.l}" y1="${gy.toFixed(1)}" x2="${W - pad.r}" y2="${gy.toFixed(1)}" stroke="var(--border)"/>
      <text x="${pad.l - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--muted)">${fmt(gv)}</text>`;
  }).join("");
  const candles = data.map((d, i) => {
    const up = d.c >= d.o, col = up ? "var(--green)" : "var(--red)";
    const cx = x(i), yo = y(d.o), yc = y(d.c);
    const top = Math.min(yo, yc), bh = Math.max(1, Math.abs(yc - yo));
    return `<line x1="${cx.toFixed(1)}" y1="${y(d.h).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${y(d.l).toFixed(1)}" stroke="${col}" stroke-width="1"/>
      <rect x="${(cx - cw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${cw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${col}"/>`;
  }).join("");
  const xl = [0, Math.floor(data.length / 2), data.length - 1].map(i =>
    `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${new Date(data[i].t).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" })}</text>`).join("");
  $("#chart-modal-body").innerHTML = (controlsHTML || "") + `<svg id="cm-svg" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    ${grid}${candles}${xl}
    <line id="cm-cur" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--text)" opacity="0"/>
    <rect id="cm-hit" x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent"/>
  </svg>`;
  const first = data[0].c, last = data[data.length - 1].c, chg = (last / first - 1) * 100;
  const baseTip = `${fmt(first)} → ${fmt(last)} · <span class="${signCls(chg)}">${signTxt(Math.round(chg * 100) / 100)}</span> nel periodo`;
  const tip = $("#chart-modal-tip"); tip.innerHTML = baseTip;
  const svg = $("#cm-svg"), hit = $("#cm-hit"), cur = $("#cm-cur");
  const move = ev => {
    const rc = svg.getBoundingClientRect();
    const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rc.left;
    const i = Math.max(0, Math.min(data.length - 1, Math.floor((px / rc.width * W - pad.l) / (W - pad.l - pad.r) * data.length)));
    const d = data[i]; cur.setAttribute("x1", x(i)); cur.setAttribute("x2", x(i)); cur.setAttribute("opacity", ".4");
    const cls = d.c >= d.o ? "pos" : "neg";
    tip.innerHTML = `${new Date(d.t).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })} · A ${fmt(d.o)} · Max ${fmt(d.h)} · Min ${fmt(d.l)} · <b class="${cls}">C ${fmt(d.c)}</b>`;
  };
  hit.addEventListener("mousemove", move);
  hit.addEventListener("touchmove", ev => { ev.preventDefault(); move(ev); }, { passive: false });
  hit.addEventListener("touchstart", move);
}

function openTickerChart(ticker) {
  cmTicker = ticker; cmRange = sparkRange in CM_SPAN ? sparkRange : "m1";
  cmView = "candles";   // ogni apertura parte dalle candele native
  drawTickerChart();
}

/* ---------------- popup informativi (macro / trimestrali) ---------------- */
function relatedNews(rx, n = 6) {
  const list = (DATA.news || []).filter(x => rx.test(x.title_it || x.title)).slice(0, n);
  if (!list.length) return '<div class="muted">Nessuna notizia correlata recente.</div>';
  return '<ul class="news-list" style="columns:1">' + list.map(x =>
    `<li class="news-item"><a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.title_it || x.title)}</a>
     <div class="news-meta"><span class="news-src">${esc(x.source)}</span><span class="news-time">${timeAgo(x.published)}</span></div></li>`).join("") + "</ul>";
}

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

function miniDualChart(pts1, pts2, { w = 420, h = 80, color1 = "var(--blue)", color2 = "var(--green)", label1 = "A", label2 = "B" } = {}) {
  if (!pts1?.length || !pts2?.length) return '<div class="muted">Dati non disponibili</div>';
  const all = [...pts1.map(p => p.v), ...pts2.map(p => p.v)];
  const mn = Math.min(...all), mx = Math.max(...all), rng = mx - mn || 1;
  const px = (i, len) => ((i / (len - 1)) * (w - 4) + 2).toFixed(1);
  const py = v => (h - 4 - (v - mn) / rng * (h - 8) + 2).toFixed(1);
  const poly = (pts) => pts.map((p, i) => `${px(i, pts.length)},${py(p.v)}`).join(" ");
  const b100 = mn <= 100 && 100 <= mx ? `<line x1="0" y1="${py(100)}" x2="${w}" y2="${py(100)}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 2"/>` : "";
  return `<div class="mini-chart-wrap">
    <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;display:block">${b100}
      <polyline points="${poly(pts2)}" fill="none" stroke="${color2}" stroke-width="1.8"/>
      <polyline points="${poly(pts1)}" fill="none" stroke="${color1}" stroke-width="2"/>
      <circle cx="${px(pts1.length-1,pts1.length)}" cy="${py(pts1[pts1.length-1].v)}" r="3" fill="${color1}"/>
      <circle cx="${px(pts2.length-1,pts2.length)}" cy="${py(pts2[pts2.length-1].v)}" r="3" fill="${color2}"/>
    </svg>
    <div class="mini-chart-legend"><span style="color:${color1}">—</span> ${label1} &nbsp; <span style="color:${color2}">—</span> ${label2} &nbsp; <span class="muted">— base 100</span></div>
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
  "in:pmi": ["Fiducia consumatori", "Sentiment delle famiglie USA (Univ. Michigan).", "Mensile (preliminare + finale)", /fiducia|sentiment|consumer|michigan/i],
  "in:curve": ["Curva 10A-2A", "Spread dei rendimenti; se negativo (inversione) storico segnale di recessione.", "Aggiornato in continuo", /curva|treasur|yield|recess|rendiment/i],
  "mk:^TNX": ["Treasury USA 10 anni", "Rendimento del decennale USA: sale = condizioni più restrittive.", "Mercato aperto USA", /treasur|10.?anni|yield|rendiment|bond/i],
  "mk:EURUSD=X": ["Cambio EUR/USD", "Euro contro dollaro: incide sul valore in € delle azioni USA.", "Continuo (forex)", /euro|dollar|eur.?usd|cambio|fx/i],
  "mk:EURJPY=X": ["Cambio EUR/JPY", "Euro contro yen.", "Continuo (forex)", /yen|jpy|euro|cambio/i],
  fear_greed: ["Fear & Greed Index", "Sentiment di mercato CNN: 0 paura estrema, 100 avidità estrema.", "Aggiornato giornalmente", /sentiment|fear|greed|paura|avidit|rally|selloff/i],
  vix: ["VIX — Volatilità", "Indice della volatilità attesa S&P500 (\"indice della paura\").", "Mercato aperto USA", /vix|volatil|selloff|panic|paura/i],
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
    extra = `<div class="info-line"><b>Range attuale:</b> ${fw.target_range} · implicito ${fmtNum.format(fw.implied_rate)}%</div>
      <div class="info-line"><b>Probabilità taglio prossima riunione:</b> ${fw.next_cut_prob}%</div>`;
    if ((fw.meetings || []).length) {
      extra += `<table class="info-table"><thead><tr><th>Riunione FOMC</th><th>Taglio</th><th>Invariato</th></tr></thead><tbody>`
        + fw.meetings.map(mt => `<tr><td>${new Date(mt.date).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}</td>
          <td class="pos">${mt.cut_prob}%</td><td>${mt.hold_prob}%</td></tr>`).join("")
        + `</tbody></table><div class="info-line muted" style="font-size:11px">Probabilità stimate dai futures sui Fed Funds (stile CME FedWatch).</div>`;
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
          ${compactSemiGauge(sm.score, ["Bearish (Short)", "Bullish (Long)"])}
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
      ${thermoBar(sm.score, ["Bearish (Short)", "Bullish (Long)"])}`;
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
      <div class="info-line"><b>Media S&P ultimi 10 anni:</b> ${pe.avg_10y}×</div>
      <div class="info-line"><b>Percentile storico S&P:</b> il mercato è stato più economico di adesso nel ${pe.pct_rank}% dei mesi degli ultimi 10 anni</div>
      ${thermoBar(pe.score, ["Sottovalutato", "Sopravvalutato"])}
      <div class="info-line muted" style="font-size:11px;margin:6px 0">
        P/E &gt;25: valutazioni tese, storicamente associate a ritorni futuri più bassi nei 10 anni successivi.
        P/E &gt;35: livelli estremi raggiunti solo nel 1999-2000 (bolla dot-com) e nel 2020-2021 (post-pandemia).<br>
        Il P/E trailing usa gli utili degli ultimi 12 mesi — è più volatile del CAPE di Shiller (10 anni), ma più reattivo.
      </div>
      <h4 style="margin:12px 0 4px">P/E S&amp;P 500 — storico 10 anni (mensile, FRED)</h4>
      ${miniLineChart(pe.history, { color: "var(--yellow)", zeroLine: false })}
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

  openInfoModal(name, `<p style="margin:0 0 10px">${desc}</p>${extra}
    <h4 style="margin:10px 0 4px">Notizie correlate</h4>${relatedNews(rx)}`);
}

function openEarningsInfo(ticker) {
  const r = (DATA.portfolio || []).find(x => x.ticker === ticker);
  if (!r) return;
  const days = r.earnings_date ? Math.ceil((new Date(r.earnings_date) - Date.now()) / 86400000) : null;
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
    <div class="info-line muted" style="margin:10px 0 12px">EPS e stime si aggiornano dopo ogni trimestrale. Target = media analisti coverage; crescita attesa e P/E prospettico dal consenso (fonte: yfinance).</div>
    <h4 style="margin:6px 0">Notizie correlate</h4>${relatedNews(rx)}`);
}

function delBtn(section, ticker) {
  if (!editMode[section]) return "";
  const mv = `<button class="row-move" data-sec="${section}" data-tk="${ticker}" data-dir="-1" title="Sposta su" aria-label="Sposta su">▲</button>
    <button class="row-move" data-sec="${section}" data-tk="${ticker}" data-dir="1" title="Sposta giù" aria-label="Sposta giù">▼</button>`;
  // solo in portafoglio: modifica quantità/PMC della posizione
  const ed = (section === "portfolio" && ticker !== "BTP-V28")
    ? `<button class="row-edit" data-tk="${ticker}" title="Modifica quantità/PMC di ${ticker}" aria-label="Modifica ${ticker}">✎</button>` : "";
  const del = ticker !== "BTP-V28"
    ? `<button class="row-del" data-sec="${section}" data-tk="${ticker}" title="Rimuovi ${ticker}">×</button>` : "";
  return mv + ed + del;
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
  recomputeTotals(); renderKPI(); renderTable(); if (ptfView === "fund") renderFundTable(); renderAllocation();
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
  const rows = sortRows(DATA.portfolio, "ptf-table").map(r => {
    const c = cur(r);
    // guadagno EUR = verità broker (bgain) se presente, altrimenti dai prezzi live
    const gEur = r.gain_eur != null ? r.gain_eur : (r.currency === "EUR" ? (r.gain || 0) : (r.gain || 0) / eurusd);
    const gPct = (r.bval != null && (r.bval - r.bgain)) ? r.bgain / (r.bval - r.bgain) * 100 : r.gain_pct;
    return `<tr>
      <td class="name-cell">${delBtn("portfolio", r.ticker)}${r.name}<span class="tk">${r.ticker}</span></td>
      <td class="num">${fmtNum.format(r.qty)}</td>
      <td class="num">${c}${fmtNum.format(r.pmc)}</td>
      <td class="num"><b>${priceTxt(r, c)}</b></td>
      <td class="num ${signCls(r.change_pct)}">${signTxt(r.change_pct)}</td>
      <td class="num">${prepostCell(r.prepost)}</td>
      <td class="num">${fmtVolume(r.volume)}</td>
      <td class="num ${signCls(gEur)}">${signTxt(Math.round(gEur), " €")}${r.currency === "USD" && r.gain != null ? `<br><span class="sub-eur muted">${signTxt(Math.round(r.gain), " $")} live</span>` : ""}</td>
      <td class="num ${signCls(gPct)}"><b>${signTxt(Math.round(gPct * 100) / 100)}</b></td>
      ${techCells(r)}
    </tr>`;
  }).join("");

  const t = DATA.totals;
  const usdValue = DATA.portfolio.filter(r => r.currency === "USD").reduce((s, r) => s + r.value, 0);
  const totalRow = `<tr class="total-row">
    <td class="name-cell" colspan="7">TOTALE — ${fmtEUR.format(t.eur_value)} · azioni $${fmtNum.format(Math.round(usdValue))}</td>
    <td class="num ${signCls(t.eur_gain)}">${signTxt(Math.round(t.eur_gain), " €")}</td>
    <td class="num ${signCls(t.eur_gain_pct)}"><b>${signTxt(t.eur_gain_pct)}</b></td>
    <td colspan="13" class="muted" style="font-family:Inter,sans-serif">netto tasse stimato: <b class="${signCls(t.eur_gain_net)}">${signTxt(Math.round(t.eur_gain_net ?? t.eur_gain), " €")}</b></td>
  </tr>`;
  const addRow = editMode.portfolio
    ? `<tr class="add-row"><td colspan="22"><button class="btn btn-ghost btn-sm" id="ptf-add">+ Aggiungi titolo</button></td></tr>` : "";
  $("#ptf-table tbody").innerHTML = rows + totalRow + addRow;
}

function renderWatchlist() {
  const list = sortRows(DATA.watchlist || [], "wl-table");
  const c = (r) => r.currency === "PTS" ? "" : "$";
  const rows = list.length ? list.map(r => `<tr>
      <td class="name-cell">${delBtn("watchlist", r.ticker)}<button class="row-add" data-tk="${r.ticker}" data-price="${r.price}" title="Aggiungi ${r.ticker} al portafoglio">➕</button>${esc(r.name)}<span class="tk">${r.ticker}</span></td>
      <td class="num"><b>${priceTxt(r, c(r))}</b></td>
      <td class="num ${signCls(r.change_pct)}">${signTxt(r.change_pct)}</td>
      <td class="num">${prepostCell(r.prepost)}</td>
      <td class="num">${fmtVolume(r.volume)}</td>
      ${techCells(r)}
    </tr>`).join("") : '<tr><td colspan="18" class="muted">Nessun dato</td></tr>';
  const addRow = editMode.watchlist
    ? `<tr class="add-row"><td colspan="18"><button class="btn btn-ghost btn-sm" id="wl-add">+ Aggiungi titolo</button></td></tr>` : "";
  $("#wl-table tbody").innerHTML = rows + addRow;
}

/* ---------------- vista fondamentale (Value Investing) ---------------- */
let ptfView = "tech";   // tech | fund
const pctOf = (v) => v == null ? "—" : signTxt(Math.round(v * 1000) / 10);   // frazione → %
const pctPlain = (v) => v == null ? "—" : (Math.round(v * 1000) / 10) + "%";
function bigUsd(v) { if (v == null) return "—"; const a = Math.abs(v);
  if (a >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return "$" + (v / 1e6).toFixed(0) + "M"; return "$" + fmtNum.format(v); }
function colorCell(txt, cls) { return `<span class="${cls || ""}">${txt}</span>`; }

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
};

// renderer fondamentale generico (riusato da portafoglio e watchlist)
function buildFundTable(list, tableSel, withQtyPmc) {
  const tableId = tableSel.replace("#", "");
  const head = (withQtyPmc ? ["Titolo", "Qtà", "PMC", "Prezzo"] : ["Titolo", "Prezzo"])
    .concat(["Market Cap", "EV/EBITDA", "ROE", "Margine lordo", "Margine netto", "P/FCF", "Cresc. ricavi", "Div Yield", "P/B", "PEG"]);
  const fundColspan = 10;
  $(`${tableSel} thead`).innerHTML = "<tr>" +
    head.map((h, i) => `<th class="${i === 0 ? "sticky-col" : "num"}">${h}</th>`).join("") + "</tr>";
  const orig = list;                          // ordine originale (per il ripristino "default")
  const sorted = sortRows(list, tableId);
  const rows = sorted.map(r => {
    const c = cur(r), st = r.stats || {};
    const lead = withQtyPmc
      ? `<td class="name-cell">${esc(r.name)}<span class="tk">${r.ticker}</span></td>
         <td class="num">${fmtNum.format(r.qty)}</td><td class="num">${c}${fmtNum.format(r.pmc)}</td>
         <td class="num"><b>${r.price == null ? "…" : c + fmtNum.format(r.price)}</b></td>`
      : `<td class="name-cell">${esc(r.name)}<span class="tk">${r.ticker}</span></td>
         <td class="num"><b>${r.price == null ? "…" : c + fmtNum.format(r.price)}</b></td>`;
    if (r.ticker === "BTP-V28" || !st.market_cap) {
      return `<tr>${lead}<td colspan="${fundColspan}" class="muted">${r.ticker === "BTP-V28" ? "Titolo di Stato — cedola 4,10/4,50%" : "Dati fondamentali non disponibili"}</td></tr>`;
    }
    const pfcf = (st.market_cap && st.fcf) ? st.market_cap / st.fcf : null;
    const peTtm = st.pe_ttm || r.pe;
    const roePrem = st.roe != null && st.roe > 0.15;
    const roeHtml = st.roe != null
      ? (roePrem
          ? `<span class="text-premium-green" title="ROIC/ROE > 15% — ritorno eccellente sul capitale investito">${fundBar(st.roe, pctOf, FSC.roe(st.roe))}</span>`
          : fundBar(st.roe, pctOf, FSC.roe(st.roe)))
      : "—";
    const pfcfWarn = pfcf != null && pfcf > 0 && peTtm > 0 && pfcf > peTtm * 2
      ? `<span class="fcf-warn" title="Warning: Controllare divergenza FCF/Utile — P/FCF ${fmtNum.format(Math.round(pfcf))}× >> P/E ${fmtNum.format(Math.round(peTtm))}×: il Free Cash Flow è significativamente inferiore al Net Income (possibili accrual contabili)"> !</span>` : "";
    const pfcfHtml = pfcf == null ? "—" : pfcf < 0 ? `<span class="neg">neg.</span>` : `${fundBar(pfcf, fmtNum.format, FSC.pfcf(pfcf))}${pfcfWarn}`;
    const revGrowthFlag = st.revenue_growth != null && st.revenue_growth < 0.05 && (st.ev_ebitda || 0) > 18
      ? `<span style="color:var(--yellow);cursor:help;font-size:11px" title="Crescita ricavi bassa (<5%) con EV/EBITDA elevato: possibile crescita non organica da acquisizioni"> ?</span>` : "";
    return `<tr class="fund-row" data-fund-tk="${r.ticker}" tabindex="0" role="button" title="${esc(r.name)} — clicca per conto economico e statistiche">${lead}
      <td class="num">${bigUsd(st.market_cap)}</td>
      <td class="num">${fundBar(st.ev_ebitda, fmtNum.format, FSC.ev(st.ev_ebitda))}</td>
      <td class="num">${roeHtml}</td>
      <td class="num">${fundBar(st.gross_margin, pctPlain, FSC.gross(st.gross_margin))}</td>
      <td class="num">${fundBar(st.profit_margin, pctPlain, FSC.net(st.profit_margin))}</td>
      <td class="num">${pfcfHtml}</td>
      <td class="num">${fundBar(st.revenue_growth, pctOf, FSC.growth(st.revenue_growth))}${revGrowthFlag}</td>
      <td class="num">${st.dividend_yield ? fundBar(st.dividend_yield, pctPlain, FSC.div(st.dividend_yield)) : "—"}</td>
      <td class="num">${fundBar(st.price_to_book, fmtNum.format, FSC.pb(st.price_to_book))}</td>
      <td class="num">${fundBar(st.peg, fmtNum.format, FSC.peg(st.peg))}</td>
    </tr>`;
  }).join("");
  $(`${tableSel} tbody`).innerHTML = rows;
  // ordinamento cliccabile sugli header (la thead è ricostruita ogni volta)
  initSorting(tableId, () => buildFundTable(orig, tableSel, withQtyPmc));
  updateSortArrows(tableId);
}

function renderFundTable() {
  if (!DATA || !DATA.portfolio) return;
  buildFundTable(DATA.portfolio, "#ptf-fund-table", true);
}
function renderWlFundTable() {
  if (!DATA || !DATA.watchlist) return;
  buildFundTable(DATA.watchlist.filter(r => r.currency !== "PTS"), "#wl-fund-table", false);
}

function setPtfView(v) {
  ptfView = v;
  document.querySelectorAll("#view-toggle .chip").forEach(c => c.classList.toggle("chip-active", c.dataset.view === v));
  $("#ptf-tech-wrap").hidden = v !== "tech";
  $("#ptf-fund-wrap").hidden = v !== "fund";
  $("#spark-toggle").style.display = v === "tech" ? "" : "none";
  $("#range-lab-tech").style.display = v === "tech" ? "" : "none";
  if (v === "fund") renderFundTable();
}

let wlView = "tech";
function setWlView(v) {
  wlView = v;
  document.querySelectorAll("#wl-view-toggle .chip").forEach(c => c.classList.toggle("chip-active", c.dataset.view === v));
  $("#wl-tech-wrap").hidden = v !== "tech";
  $("#wl-fund-wrap").hidden = v !== "fund";
  $("#spark-toggle-wl").style.display = v === "tech" ? "" : "none";
  $("#wl-range-lab").style.display = v === "tech" ? "" : "none";
  if (v === "fund") renderWlFundTable();
}

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
  const all = [...DATA.portfolio, ...(DATA.watchlist || [])];
  const items = all
    .filter(r => r.earnings_date)
    .map(r => ({ ...r, days: Math.ceil((new Date(r.earnings_date) - Date.now()) / 86400000) }))
    .filter(r => r.days >= -1)
    .sort((a, b) => a.days - b.days);
  const ptfTickers = new Set(DATA.portfolio.map(x => x.ticker));
  $("#earnings-strip").innerHTML = items.length ? items.map(r => {
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
function gaugeSVG(pct, color) {
  // semicerchio 0–100
  const angle = Math.PI * (1 - pct / 100);
  const x = 60 + 48 * Math.cos(angle), y = 58 - 48 * Math.sin(angle);
  return `<svg viewBox="0 0 120 66">
    <path d="M 12 58 A 48 48 0 0 1 108 58" fill="none" stroke="var(--border)" stroke-width="9" stroke-linecap="round"/>
    <path d="M 12 58 A 48 48 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"/>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${color}"/>
  </svg>`;
}

function fgColor(score) {
  if (score <= 25) return "var(--red)";
  if (score <= 45) return "var(--yellow)";
  if (score <= 55) return "var(--muted)";
  if (score <= 75) return "var(--green)";
  return "var(--cyan)";
}

const FG_LABELS = { "extreme fear": "Paura estrema", fear: "Paura", neutral: "Neutrale", greed: "Avidità", "extreme greed": "Avidità estrema" };

/* colore sfumato verde(100)→arancio(50)→rosso(0) */
function scoreColor(s) {
  const h = Math.max(0, Math.min(120, (s / 100) * 120));   // 0=rosso, 60=giallo, 120=verde
  return `hsl(${h.toFixed(0)} 75% 47%)`;
}
// scala SEMPRE verde(sx)→rosso(dx). score 0-100 (100=positivo): il marker del "buono"
// sta a sinistra (verde), quello "cattivo" a destra (rosso). ends[0]=sinistra(verde).
function thermoBar(score, ends) {
  const s = Math.max(0, Math.min(100, score));
  const pos = 100 - s;
  return `<div class="thermo"><div class="thermo-scale"></div>
    <div class="thermo-marker" style="left:${pos}%"></div></div>
    ${ends ? `<div class="thermo-ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>` : ""}`;
}
/* card termometro uniforme; score 0-100 (100=positivo/verde, a sinistra). key per il popup */
function thermoCard(key, title, score, valueText, subText, ends) {
  // Gauge semicircolare: verde sx (favorevole, score=100) → rosso dx (sfavorevole, score=0)
  const s = Math.max(0, Math.min(100, score ?? 50));
  const R = 68, cx = 88, cy = 80;
  const zones = [
    [0,  20, "#16a34a"],
    [20, 40, "#86c52a"],
    [40, 60, "#eab308"],
    [60, 80, "#f97316"],
    [80, 100,"#d23b30"],
  ];
  const pt = (val, r) => {
    const a = Math.PI * (1 - val / 100);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };
  const arcs = zones.map(([a, b, col]) => {
    const [x1, y1] = pt(a, R), [x2, y2] = pt(b, R);
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${col}" stroke-width="14" stroke-linecap="butt"/>`;
  }).join("");
  // score 100 → ago sx (verde); score 0 → ago dx (rosso)
  const nv = Math.max(5, Math.min(95, 100 - s)); // clamp: evita che l'ago tocchi la baseline
  const [nx, ny] = pt(nv, R - 9);
  const col = scoreColor(s);
  const endsHtml = ends ? `<div class="gauge-ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>` : "";
  return `<div class="gauge-card" data-gauge="${key}" tabindex="0" role="button" title="Clicca per dettagli e news">
    <span class="popup-dot"></span>
    <div class="g-title">${title}</div>
    <svg viewBox="0 0 176 90" class="semi-gauge-svg">
      ${arcs}
      <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${col}" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="5" fill="${col}"/>
    </svg>
    ${endsHtml}
    <div class="gauge-value" style="color:${col}">${valueText}</div>
    <div class="gauge-sub">${subText}</div>
  </div>`;
}

/* gauge semicircolare compatto per macro-item e mini-card */
function compactSemiGauge(score, ends) {
  const s = Math.max(0, Math.min(100, score ?? 50));
  const R = 50, cx = 65, cy = 57;
  const zones = [
    [0,  20, "#16a34a"],
    [20, 40, "#86c52a"],
    [40, 60, "#eab308"],
    [60, 80, "#f97316"],
    [80, 100,"#d23b30"],
  ];
  const pt = (val, r) => { const a = Math.PI * (1 - val / 100); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
  const arcs = zones.map(([a, b, col]) => {
    const [x1, y1] = pt(a, R), [x2, y2] = pt(b, R);
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${col}" stroke-width="9" stroke-linecap="butt"/>`;
  }).join("");
  const nv = Math.max(5, Math.min(95, 100 - s));
  const [nx, ny] = pt(nv, R - 7);
  const col = scoreColor(s);
  const endsHtml = ends ? `<div class="gauge-ends" style="font-size:9px;padding:0 2px"><span>${ends[0]}</span><span>${ends[1]}</span></div>` : "";
  return `<svg viewBox="0 0 130 64" class="compact-semi-gauge">
    ${arcs}
    <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${col}" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="4" fill="${col}"/>
  </svg>${endsHtml}`;
}

/* tachimetro Fear & Greed: semicerchio stile CNN con lancetta — paura=sx, avidità=dx */
function fgGaugeCNN(score) {
  const s = Math.max(0, Math.min(100, score));
  const R = 68, cx = 88, cy = 80;
  // F&G: 0=paura=sx, 100=avidità=dx (convenzionale CNN — non invertito)
  const zones = [[0, 25, "#d23b30"], [25, 45, "#f59e0b"], [45, 55, "#eab308"], [55, 75, "#86c52a"], [75, 100, "#16a34a"]];
  const pt = (val, r) => { const a = Math.PI * (1 - val / 100); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
  const arcs = zones.map(([a, b, col]) => {
    const [x1, y1] = pt(a, R), [x2, y2] = pt(b, R);
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${col}" stroke-width="14" stroke-linecap="butt"/>`;
  }).join("");
  const [nx, ny] = pt(s, R - 9);
  const col = s >= 55 ? "#16a34a" : s >= 45 ? "#eab308" : "#d23b30";
  return `<svg viewBox="0 0 176 90" class="semi-gauge-svg">
    ${arcs}
    <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${col}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="5" fill="${col}"/>
    <text x="${cx}" y="${cy - 20}" text-anchor="middle" font-size="22" font-weight="700" fill="var(--text)">${Math.round(s)}</text>
  </svg>`;
}

function renderGauges() {
  const m = DATA.macro || {};
  const cards = [];

  if (m.risk_sentiment) {
    const rs = m.risk_sentiment;
    cards.push(thermoCard("sentiment", "Sentiment globale", rs.score, rs.score,
      `<b>${rs.label}</b><br>composito F&amp;G · VIX · P/C · BTC · 10A`, ["Risk-on", "Risk-off"]));
  }
  if (m.fear_greed) {
    const fg = m.fear_greed;
    cards.push(`<div class="gauge-card" data-gauge="fear_greed" tabindex="0" role="button" title="Clicca per dettagli e news">
      <span class="popup-dot"></span>
      <div class="g-title">Fear &amp; Greed</div>
      ${fgGaugeCNN(fg.score)}
      <div class="gauge-sub"><b>${FG_LABELS[fg.rating] || fg.rating}</b> · 1 sett: ${fg.week_ago} · 1 mese: ${fg.month_ago}</div>
    </div>`);
  }
  if (m.vix) {
    const score = Math.max(0, Math.min(100, 100 - m.vix.value / 50 * 100));   // VIX basso = verde
    cards.push(thermoCard("vix", "VIX — Volatilità", score, fmtNum.format(m.vix.value),
      `${signTxt(m.vix.change_pct)} oggi<br>${m.vix.value < 17 ? "Mercato calmo" : m.vix.value < 25 ? "Tensione moderata" : "Alta volatilità"}`, ["Calmo", "Panico"]));
  }
  if (m.fedwatch) {
    const fw = m.fedwatch;
    const score = Math.max(0, Math.min(100, 50 - fw.delta_bp));   // tagli prezzati = verde
    const dir = fw.delta_bp <= -10 ? `tagli prezzati (~${Math.abs(fw.delta_bp)} bp)` :
                fw.delta_bp >= 10 ? `rialzi prezzati (~${fw.delta_bp} bp)` : "tassi fermi attesi";
    cards.push(thermoCard("fedwatch", "FedWatch (futures FF)", score, fw.target_range,
      `implicito <b>${fmtNum.format(fw.implied_rate)}%</b> · ${dir}`, ["Accomodante", "Restrittivo"]));
  }
  if (m.carry) {
    const cy = m.carry;
    const score = Math.max(0, Math.min(100, cy.spread / 5 * 100));
    cards.push(thermoCard("carry", "Carry USD/JPY — Rischio", score, `${fmtNum.format(cy.spread)} pp spread`,
      `US10A ${fmtNum.format(cy.us10)}% − JGB ${fmtNum.format(cy.jp10)}%<br>USD/JPY ${fmtNum.format(cy.usdjpy)} (${signTxt(cy.usdjpy_chg_1m)} 1m)`, ["Rischio Basso", "Rischio Elevato"]));
  }
  if (m.putcall) {
    const pc = m.putcall;
    const score = Math.max(0, Math.min(100, 100 - pc.ratio / 2 * 100));   // più call = verde
    cards.push(thermoCard("putcall", `Put/Call ${pc.symbol}`, score, fmtNum.format(pc.ratio),
      `<b>${pc.ratio > 1 ? "Prevalgono PUT" : "Prevalgono CALL"}</b><br>put ${pc.puts.toLocaleString("it-IT")} · call ${pc.calls.toLocaleString("it-IT")}`, ["Call", "Put"]));
  }
  if (m.credit) {
    const cr = m.credit;
    cards.push(thermoCard("credit", "Rischio Credito (HY)", cr.score,
      `${fmtNum.format(cr.spread_hy)}% OAS`,
      `ICE BofA HY · <b style="color:${scoreColor(cr.score)}">${cr.label}</b><br>spread alto = stress sistemico`, ["Basso", "Elevato"]));
  }
  if (m.smart_money) {
    const sm = m.smart_money;
    const fgGauge = m.fear_greed?.score;
    let divTxt = "";
    if (fgGauge != null && sm.score != null) {
      if (fgGauge > 75 && sm.score < 30)
        divTxt = `<br><b style="color:var(--red)">DIVERGENZA PERICOLOSA</b>`;
      else if (fgGauge < 25 && sm.score > 70)
        divTxt = `<br><b style="color:var(--green)">ACCUMULO ISTITUZIONALE</b>`;
      else if (sm.divergence != null && Math.abs(sm.divergence) > 15)
        divTxt = `<br><b style="color:var(--yellow)">${sm.divergence_label}</b>`;
    } else if (sm.divergence != null) {
      divTxt = `<br><b style="color:${Math.abs(sm.divergence) > 15 ? "var(--yellow)" : "var(--muted)"}">${sm.divergence_label}</b>`;
    }
    cards.push(thermoCard("smart_money", "Istituzionali VS Retail", sm.score,
      `<b>${sm.label}</b>`,
      `flussi istituzionali${divTxt}`, ["Bearish", "Bullish"]));
  }
  if (m.sp500_pe) {
    const pe = m.sp500_pe;
    const peCol = pe.current > 35 ? "var(--red)" : pe.current > 25 ? "var(--yellow)" : pe.current > 14 ? "var(--muted)" : "var(--green)";
    const ndxStr = pe.nasdaq_pe ? ` · NDX ${pe.nasdaq_pe}×` : "";
    cards.push(thermoCard("sp500_pe", "P/E S&P 500 / Nasdaq", pe.score,
      `<span style="color:${peCol}">S&P ${pe.current}×</span>${ndxStr ? `<span class="muted" style="font-size:12px">${ndxStr}</span>` : ""}`,
      `${pe.label} · media 10A ${pe.avg_10y}× · percentile ${pe.pct_rank}°`, ["Sottovalutato", "Sopravvalutato"]));
  }
  if (m.corp_profit) {
    const cp = m.corp_profit;
    const gapCol = cp.gap > 40 ? "var(--red)" : cp.gap > 20 ? "var(--yellow)" : "var(--green)";
    const ndxGapStr = cp.ndx_gap != null ? ` · NDX ${cp.ndx_gap > 0 ? "+" : ""}${cp.ndx_gap} pp` : "";
    cards.push(thermoCard("corp_profit", "S&P+NDX vs Profitti Reali", cp.score,
      `<span style="color:${gapCol}">S&P ${cp.gap > 0 ? "+" : ""}${cp.gap} pp${ndxGapStr}</span>`,
      `<b style="color:${gapCol}">${cp.label}</b>`, ["Allineati", "Asset Inflation"]));
  }
  $("#gauges").innerHTML = cards.join("") || '<span class="muted">Dati non disponibili</span>';
}

/* ---------------- macro ---------------- */
const MACRO_ACCENTS = { cpi: "var(--red)", pce: "var(--yellow)", gdp: "var(--blue)", retail: "var(--purple)", nfp: "var(--green)", unemp: "var(--cyan)", pmi: "var(--blue)", "BTC-USD": "var(--yellow)", "CL=F": "var(--purple)", "^KS11": "var(--cyan)", "^IXIC": "var(--blue)" };

function impactBar(score, titleTxt) {
  if (score === null || score === undefined) return "";
  return `<div class="impact" title="${titleTxt || "impatto sul mercato"}: ${score}/100">
    <span class="impact-fill" style="width:${Math.max(4, score)}%;background:${scoreColor(score)}"></span>
  </div>`;
}

function marketImpact(m) {
  // variazione giornaliera → impatto 0-100 (rendimenti in pp: salita = restrittivo)
  if (m.change_pct === null || m.change_pct === undefined) return null;
  if (m.suffix === " pp") return Math.round(Math.max(0, Math.min(100, 50 - m.change_pct * 300)));
  return Math.round(Math.max(0, Math.min(100, 50 + m.change_pct * 12)));
}

function renderMacro() {
  const m = DATA.macro || {};
  // termometro coerente: verde a sx (favorevole per il portafoglio) → rosso a dx (sfavorevole)
  const macroThermo = (score) => score == null ? "" :
    compactSemiGauge(score, ["favorevole", "sfavorevole"]);
  const markets = (DATA.macro?.markets || []).map(m => `
    <div class="macro-item" data-macro="mk:${m.key}" tabindex="0" role="button" title="Clicca per dettagli e news" style="--accent:${MACRO_ACCENTS[m.key] || "var(--blue)"}">
      <span class="popup-dot"></span>
      <div class="m-label">${m.label}</div>
      <div class="m-value">${m.value}</div>
      <div class="m-sub ${signCls(m.change_pct)}">${signTxt(m.change_pct, m.suffix || "%")} oggi</div>
      ${macroThermo(marketImpact(m))}
    </div>`);
  const indicators = (DATA.macro?.indicators || []).map(i => `
    <div class="macro-item" data-macro="in:${i.key}" tabindex="0" role="button" title="Clicca per dettagli e news" style="--accent:${MACRO_ACCENTS[i.key] || "var(--purple)"}">
      <span class="popup-dot"></span>
      <div class="m-label">${i.label}</div>
      <div class="m-value">${i.value}</div>
      <div class="m-date">${i.date}</div>
      ${macroThermo(i.impact)}
    </div>`);
  const cells = markets.concat(indicators);

  // Disaccoppiamento macro: S&P 500 vs PIL reale
  const dc = DATA.macro?.decouple;
  if (dc?.sp500?.length && dc?.gdp?.length) {
    const spLast = dc.sp500[dc.sp500.length - 1].v;
    const gdLast = dc.gdp[dc.gdp.length - 1].v;
    const gap = Math.round(spLast - gdLast);
    const gapCol = gap > 40 ? "var(--red)" : gap > 20 ? "var(--yellow)" : "var(--green)";
    const gapScore = Math.max(0, Math.min(100, 100 - gap / 1.2));
    cells.push(`<div class="macro-item" data-macro="decouple" tabindex="0" role="button" title="Clicca per grafico S&P vs PIL" style="--accent:var(--blue)">
      <span class="popup-dot"></span>
      <div class="m-label">Disaccoppiamento Macro</div>
      <div class="m-value" style="color:${gapCol}">${gap > 0 ? "+" : ""}${gap} pp</div>
      <div class="m-date">S&amp;P ${signTxt(Math.round(spLast - 100))} · PIL ${signTxt(Math.round(gdLast - 100))}</div>
      ${macroThermo(gapScore)}
    </div>`);
  }
  if (m.sp500_pe) {
    const pe = m.sp500_pe;
    const peCol = pe.current > 35 ? "var(--red)" : pe.current > 25 ? "var(--yellow)" : pe.current > 14 ? "var(--muted)" : "var(--green)";
    const ndxLine = pe.nasdaq_pe ? `<div class="m-date" style="margin-top:2px">NDX (QQQ): <b>${pe.nasdaq_pe}×</b></div>` : "";
    cells.push(`<div class="macro-item" data-macro="sp500_pe" tabindex="0" role="button" title="Clicca per storico P/E" style="--accent:var(--yellow)">
      <span class="popup-dot"></span>
      <div class="m-label">P/E S&amp;P 500 / Nasdaq</div>
      <div class="m-value" style="color:${peCol}">${pe.current}×</div>
      <div class="m-date">S&amp;P · ${pe.label} · media 10A ${pe.avg_10y}×</div>
      ${ndxLine}
      ${macroThermo(pe.score)}
    </div>`);
  }
  if (m.fed_market) {
    const fm = m.fed_market;
    const rateCol = fm.current_rate > 4.5 ? "var(--red)" : fm.current_rate > 2.5 ? "var(--yellow)" : "var(--green)";
    const rateScore = clamp(100 - (fm.current_rate - 0) / 6 * 100);
    cells.push(`<div class="macro-item" data-macro="fed_market" tabindex="0" role="button" title="Clicca per grafico Fed Funds vs S&P" style="--accent:var(--red)">
      <span class="popup-dot"></span>
      <div class="m-label">Fed Funds vs Mercato</div>
      <div class="m-value" style="color:${rateCol}">${fm.current_rate}%</div>
      <div class="m-date">tasso Fed attuale · clicca per storico</div>
      ${macroThermo(rateScore)}
    </div>`);
  }
  if (m.yield_recession) {
    const yr = m.yield_recession;
    const cc = yr.current_curve;
    const col = cc == null ? "var(--muted)" : cc < 0 ? "var(--red)" : yr.steepening ? "var(--yellow)" : "var(--green)";
    // score favorevolezza: invertita o irripidimento post-inversione = sfavorevole
    const score = cc == null ? 50 : (yr.steepening && yr.was_inverted_24m) ? 25 : cc < 0 ? 15 : clamp(50 + cc * 25);
    cells.push(`<div class="macro-item" data-macro="yield_recession" tabindex="0" role="button" title="Clicca per l'analisi curva vs recessioni" style="--accent:var(--blue)">
      <span class="popup-dot"></span>
      <div class="m-label">Curva &amp; Recessione</div>
      <div class="m-value" style="color:${col}">${cc != null ? (cc > 0 ? "+" : "") + fmtNum.format(cc) + " pp" : "—"}</div>
      <div class="m-date">${esc((yr.label || "").split(" — ")[0])}</div>
      ${macroThermo(score)}
    </div>`);
  }
  if (m.systemic_risk) {
    const sr = m.systemic_risk;
    const col = sr.rising ? "var(--red)" : sr.score >= 60 ? "var(--green)" : sr.score <= 40 ? "var(--red)" : "var(--yellow)";
    cells.push(`<div class="macro-item" data-macro="systemic_risk" tabindex="0" role="button" title="Clicca per il dettaglio rischio sistemico e credito" style="--accent:var(--red)">
      <span class="popup-dot"></span>
      <div class="m-label">Rischio Sistemico (CDS)</div>
      <div class="m-value" style="color:${col}">${sr.hy_oas != null ? fmtNum.format(sr.hy_oas) + "%" : "—"}${sr.hy_chg_1m != null ? ` <span style="font-size:11px" class="${signCls(sr.hy_chg_1m)}">${signTxt(sr.hy_chg_1m)} 1m</span>` : ""}</div>
      <div class="m-date">${esc((sr.status || "").split(" — ")[0])}</div>
      ${macroThermo(sr.score)}
    </div>`);
  }

  $("#macro-grid").innerHTML = cells.length ? cells.join("") : '<span class="muted">Dati non disponibili</span>';
}

/* ---------------- top capitalizzazioni ---------------- */
function fmtMcap(v) {
  if (v >= 1e12) return "$" + fmtNum.format(Math.round(v / 1e10) / 100) + "T";
  return "$" + fmtNum.format(Math.round(v / 1e9)) + "B";
}

function renderTopCaps() {
  const list = DATA.top_caps || [];
  if (!list.length) { $("#topcaps").innerHTML = ""; return; }
  // NB: le barre ETF settoriali sono state rimosse (duplicavano il widget "Rotazione settoriale (Tilt)";
  // il dettaglio resta nel popup del widget Tilt → rotationDetailHtml).
  $("#topcaps").innerHTML =
    `<div class="m-label" style="margin:14px 0 8px">Top 10 capitalizzazioni mondiali</div>
    <ol class="topcap-list">` + list.map((x, i) => `
      <li class="topcap-item">
        <span class="topcap-rank">${i + 1}</span>
        <span class="topcap-name">${esc(x.name)} <span class="tk">${x.ticker}</span></span>
        <span class="topcap-mcap">${fmtMcap(x.mcap_usd)}</span>
        <span class="topcap-chg ${signCls(x.change_pct)}">${signTxt(x.change_pct)}</span>
      </li>`).join("") + "</ol>";
}

/* ---------------- top ETF dashboard ---------------- */
function etfOpportunity(rsi) {
  if (rsi == null) return { label: "—", color: "var(--muted)" };
  if (rsi < 35) return { label: "Ipervenduto — possibile ingresso", color: "var(--green)" };
  if (rsi < 48) return { label: "Zona neutro-bassa — da monitorare", color: "var(--yellow)" };
  if (rsi < 65) return { label: "Momentum positivo", color: "var(--muted)" };
  return { label: "Ipercomprato — attendere ritracciamento", color: "var(--red)" };
}

function renderTopETFs() {
  const list = DATA.top_etfs || [];
  const wrap = $("#top-etfs-wrap");
  if (!list.length) { wrap.innerHTML = ""; return; }

  const fmtAum = v => v >= 1000 ? `$${(v / 1000).toFixed(1)}T` : v ? `$${v}B` : "—";

  const rows = list.map(r => {
    const opp = etfOpportunity(r.rsi);
    const m1  = r.sparks?.m1;
    const m1v = (m1 && m1.length >= 2 && m1[0]) ? (m1[m1.length - 1] / m1[0] - 1) * 100 : null;
    const m3  = r.sparks?.m3;
    const m3v = (m3 && m3.length >= 2 && m3[0]) ? (m3[m3.length - 1] / m3[0] - 1) * 100 : null;
    return `<tr>
      <td class="sticky-col"><b>${esc(r.ticker)}</b></td>
      <td>${esc(r.name)}</td>
      <td class="num">${r.price != null ? "$" + fmtNum.format(r.price) : "—"}</td>
      <td class="num ${signCls(r.change_pct)}">${signTxt(r.change_pct)}</td>
      <td class="num ${m1v != null ? signCls(m1v) : ""}">${m1v != null ? signTxt(Math.round(m1v * 10) / 10) : "—"}</td>
      <td class="num ${m3v != null ? signCls(m3v) : ""}">${m3v != null ? signTxt(Math.round(m3v * 10) / 10) : "—"}</td>
      <td class="num">${r.rsi ?? "—"}</td>
      <td class="num">${r.pe != null ? fmtNum.format(r.pe) : "—"}</td>
      <td class="num">${r.div_yield ? r.div_yield + "%" : "—"}</td>
      <td class="num">${fmtAum(r.aum)}</td>
      <td style="color:${opp.color};font-size:12px">${opp.label}</td>
    </tr>`;
  }).join("");

  wrap.innerHTML = `
    <div class="m-label" style="margin:14px 0 8px">Top 10 ETF — Metriche &amp; Opportunità di Ingresso</div>
    <div class="table-wrap">
      <table aria-label="Top 10 ETF">
        <thead><tr>
          <th class="sticky-col">Ticker</th>
          <th>ETF</th>
          <th class="num">Prezzo</th>
          <th class="num">Oggi</th>
          <th class="num">1M</th>
          <th class="num">3M</th>
          <th class="num">RSI</th>
          <th class="num">P/E</th>
          <th class="num">Div.%</th>
          <th class="num">AUM</th>
          <th>Segnale</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="muted" style="font-size:11px;margin-top:6px">
      RSI &lt;35 = ipervenduto (potenziale ingresso); RSI &gt;70 = ipercomprato (attendere).
      P/E e dividendo da Yahoo Finance. AUM = patrimonio gestito.
    </div>`;
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

function renderNews() {
  // solo notizie delle ultime 24 ore (oltre a quanto già filtrato dalla pipeline)
  const cutoff = Date.now() - 26 * 3600 * 1000;
  let list = (DATA.news || []).filter(n => !n.published || new Date(n.published).getTime() >= cutoff);
  if (!list.length) list = DATA.news || [];   // fallback: se tutte vecchie, mostra comunque
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
function buildPrompt() {
  const t = DATA.totals;
  const m = DATA.macro || {};
  const lines = [];
  const GOAL = 1_000_000;
  const patrimonio = t.eur_invested + cashEur;
  const cagrNeeded = patrimonio > 0 && patrimonio < GOAL
    ? ((Math.pow(GOAL / patrimonio, 1 / 10) - 1) * 100).toFixed(1) : "0.0";
  const distPct = ((patrimonio / GOAL - 1) * 100).toFixed(1);
  const distEur = Math.round(GOAL - patrimonio);
  lines.push(`*** DISTANZA DALL'OBIETTIVO: patrimonio attuale ${fmtEUR.format(Math.round(patrimonio))} / obiettivo €1.000.000 — completamento ${(patrimonio/GOAL*100).toFixed(1)}% — CAGR necessario: ${cagrNeeded}% annuo per 10 anni — mancano ${fmtEUR.format(distEur > 0 ? distEur : 0)} ***`);
  lines.push("");
  lines.push("MANDATO OBIETTIVO — LEGGILO PRIMA DI TUTTO IL RESTO:");
  lines.push(`Cliente: uomo 40 anni. Obiettivo: €1.000.000 netti in 10 anni (CAGR target ~12-15% annuo, necessario oggi: ${cagrNeeded}%). Profilo: DIAMOND HANDS — tollera drawdown del -20-30% senza vendere (orizzonte decade, non settimana). Piano di transizione: FASE 1 (attuale) = semiconduttori/hardware AI → FASE 2 (2026-2028) = Software AI / Cloud / Cybersecurity / Biotech AI — iniziare rotazione anticipata. La liquidità disponibile (${fmtEUR.format(cashEur)}) è "polvere secca" da deployare in zone di correzione identificate dai dati di drawdown. Ogni raccomandazione deve essere COERENTE con questo mandato: non suggerire uscite per paura, non suggerire diversificazione difensiva eccessiva che riduce il CAGR sotto il ${cagrNeeded}% necessario.`);
  lines.push("");
  lines.push("IDENTITÀ OPERATIVA — NON SEI UN ADVISOR RETAIL: ragiona, parla e struttura le operazioni con la freddezza e l'intelligenza adattiva, opportunistica e spietata di un HEDGE FUND SPECULATIVO (Long/Short Equity & Venture Capital). Abbandona ogni rigidità retail. Applica SEMPRE questi 4 PILASTRI ISTITUZIONALI a ogni raccomandazione:");
  lines.push(`① ADATTABILITÀ E GESTIONE ASIMMETRICA (Scale-In / Scale-Out): ABBANDONA la logica binaria "Compra Tutto / Vendi Tutto". Quando un titolo è in forte ipercomprato, raggiunge multipli tossici (es. P/E > 150 senza iper-crescita) o si avvicina a un catalizzatore binario estremo (es. trimestrale imminente con estensione estrema del prezzo), NON proporre uscita totale: calcola e proponi un TRIMMING STRATEGICO parziale (alleggerimento del 25-50%, indica N azioni esatte) per recuperare il capitale di rischio e lasciare correre la posizione residua in "FREE RIDE" (profitto puro senza rischio sul trend).`);
  lines.push(`② TAX ALPHA (Ottimizzazione Fiscale Dinamica): le tasse uccidono l'interesse composto. Ogni volta che proponi una presa di profitto (capital gain tassato 26%), DEVI scansionare il portafoglio cercando "aziende zombie" (ROIC negativo, FCF negativo, tesi fondamentale rotta, trend strutturalmente compromesso) da liquidare in perdita per generare SCUDI FISCALI (minusvalenze). Calcola la quantità ESATTA di azioni da vendere in profitto e in perdita affinché le minusvalenze assorbano quasi interamente le plusvalenze → tasse vicine a zero e massima liquidità netta generata ("polvere secca"). Ricorda: in Italia le minus compensano le plus entro il quadriennio fiscale.`);
  lines.push(`③ VALUTAZIONE DEI CATALIZZATORI (Macro & Politici): non basarti SOLO sui bilanci. Se un'azienda anche in perdita ottiene un catalizzatore governativo/sistemico (es. sussidi USA su Quantum Computing per RGTI, partnership AI strategiche per GOOGL/MU/AMD), la logica fondamentale passa in secondo piano: il titolo diventa un'OPZIONE "MOONSHOT" speculativa e va MANTENUTO/accumulato per il potenziale rialzo esponenziale. Cita i catalizzatori politici/macro emersi dalla ricerca web.`);
  lines.push(`④ GESTIONE DELLA POLVERE SECCA (Liquidity as a Weapon): la cassa NON si usa mai sui massimi. Solo nelle giornate "Blood in the streets" (VIX > 20, pre-market in rosso sangue, crolli asiatici/europei) la liquidità (${fmtEUR.format(cashEur)}) va schierata come trappola: proponi ORDINI LIMITE di acquisto millimetrici sui supporti tecnici chiave per asset di altissima qualità. In quei giorni NON limitarti al tech: scansiona la watchlist anche su settori non-tech penalizzati da vendite indiscriminate (Value, Financials, Aerospace/Difesa, Cloud, Data, Banche) e privilegia i titoli con i migliori fondamentali (ROIC > 15%) su supporti millimetrici. Se il prezzo non raggiunge il limite, la liquidità si CONSERVA — nessun inseguimento.`);
  lines.push("");
  lines.push(`Sei un SENIOR PORTFOLIO ADVISOR con competenze integrate di macro, equity, tecnica e risk management — profilo istituzionale da $10B+ fund, specializzato in growth tech USA. Produci un'analisi UNIVOCA, COESA e AZIONABILE: non cinque voci separate, ma un REPORT PROFESSIONALE UNICO come se fossi il CIO di un family office. Usa tutti i dati forniti (prezzi, fondamentali, macro, news, opzioni, SMC). Nessun disclaimer, nessuna vaghezza: solo numeri, ticker precisi, quantità precise, livelli precisi.

TEAM DI RIFERIMENTO INTERNO (usali per arricchire l'analisi, NON come sezioni separate):
• MARCO (Macro & Ciclo): curva tassi, carry, credito HY, PIL, Fed, istituzionali vs retail, rotazione settoriale
• SARA (Equity & Fondamentali): DCF, multipli, FCF quality, ROIC, target price, catalizzatori trimestrali
• LEI (Tecnica & Timing): RSI, supporti/resistenze, SMC/BOS/FVG, volume, forza relativa, timing entrata`);
  lines.push("");
  lines.push("STEP 1 — RICERCA WEB (obbligatoria PRIMA del report): (a) prezzi e variazioni intraday di TUTTI i titoli in portafoglio e watchlist; (b) notizie ultime 48h per ogni titolo (earnings, guidance, upgrade/downgrade, M&A, regolazione, Fed/BoJ); (c) calendario eventi prossimi 30 giorni (FOMC, BoJ, trimestrali, dati macro chiave); (d) 2-3 nuove idee di ingresso non in portafoglio (momentum, value o event-driven) coerenti con mandato €1M/10 anni. Se i dati web contraddicono quelli sotto, cita la fonte e usa i dati più aggiornati.");
  lines.push("");
  lines.push(`PRODUCI UN REPORT UNICO STRUTTURATO in queste 5 sezioni — rispondi come UN UNICO ADVISOR che integra tutte le competenze:

## 1. QUADRO MACRO & REGIME DI MERCATO
Analizza in modo APPROFONDITO tutti i dati macro forniti:
- Curva 10A-2A: valore attuale, tendenza, implicazioni recessione/espansione
- Spread credito HY (OAS): livello, trend 1M, stress sistemico sì/no
- Carry USD/JPY: spread tassi, rischio unwind yen, prossima BoJ
- Fear & Greed vs Istituzionali: divergenza? Se sì → classificala (PERICOLOSA / ACCUMULO / NEUTRALE)
- P/E S&P e Nasdaq vs profitti reali: mercato sopravvalutato o in linea?
- MacroQuant (ciclo economico): espansione/contrazione, cosa sta guidando
- Rotazione settoriale: quali settori in forza/debolezza, implicazione per portafoglio tech
- Fed Watch: scenario tassi prossimi 6 mesi
**VERDETTO FINALE:** regime bull/bear/range + sovrappeso/sottopeso azionario USA tech nelle prossime 8 settimane. Risponde al mandato CAGR ${cagrNeeded}%?

## 2. ANALISI PER SINGOLO TITOLO (portafoglio + watchlist)
Per OGNI titolo usa questo formato fisso — non saltare nessuna voce:

### [TICKER] — [Nome]  [PORTAFOGLIO | WATCHLIST]
**NEWS & CONTESTO (ultime 48h):** 2-3 righe. Cosa è successo al titolo di recente? Earnings, guidance, upgrade/downgrade, news di settore rilevanti, movimenti istituzionali. Se niente di rilevante, scrivi "Nessuna news materiale".
**FONDAMENTALI:** P/E [X]× (settore [Y]×) · P/FCF [X]× [!FCF se >> P/E] · ROIC [X]% [PREMIUM se >15% | ZOMBIE se <0] · Margine netto [X]% · Crescita ricavi [X]% · PEG [X] · Fair value stimato: $[X] ([upside/downside]% dal prezzo attuale).
**CATALIZZATORE (Pilastro ③):** [Moonshot — catalizzatore governativo/macro/partnership AI presente, mantieni a prescindere dai bilanci | Nessun catalizzatore speciale]
**TECNICA:** RSI [X] ([ipercomprato >70 | neutro | ipervenduto <30]) · Supporto chiave: $[X] (rottura = stop loss) · Resistenza chiave: $[X] (target swing) · Volume: [anomalo/normale] · SMC: [struttura rialzista/ribassista/BOS/FVG] · Forza relativa 1M vs [SOX/NDX/S&P]: [+X% / -X% — outperform/underperform]
**AZIONE RACCOMANDATA (Pilastro ①, mai binaria):** [MANTIENI | FREE RIDE: TRIM 25-50% (N azioni esatte a $Y limite — multiplo tossico/catalizzatore binario, recupero capitale di rischio) | INCREMENTA N azioni a $Y limite | LIQUIDA SCUDO FISCALE: vendi N azioni in perdita (azienda zombie, Pilastro ②) | ATTENDI INGRESSO a $Y] — Stop: $[X]. Motivazione in 1 riga.

---
*(ripeti per ogni titolo)*

**RIEPILOGO SEZIONE 2:** Setup MIGLIORE per le prossime 2-4 settimane: [ticker]. Setup PEGGIORE: [ticker]. Zone di accumulo (drawdown >15% dal max 52S, polvere secca ${fmtEUR.format(cashEur)}): [titoli con opportunità]. Titoli "Moonshot" da mantenere per catalizzatore: [ticker]. Aziende "zombie" candidate a scudo fiscale: [ticker].

## 3. PIANO OPERATIVO PRIORITÀ & TAX ALPHA (Pilastri ① ② ④)
**a) Azioni urgenti questa settimana** (ordine di priorità): 1. [ticker, N azioni, prezzo limite, motivazione] · 2. ...
**b) TRIMMING STRATEGICO (Free Ride):** per ogni titolo ipercomprato / con multiplo tossico (P/E>150) / con earnings binario imminente → quante azioni alleggerire (25-50%) per incassare il capitale di rischio lasciando correre il resto. Indica plus lorda e residuo in Free Ride.
**c) BILANCIAMENTO FISCALE DINAMICO (Tax Alpha):** se il punto (b) genera plusvalenze tassabili, ABBINA le vendite in profitto a vendite in perdita di aziende zombie (ROIC negativo / tesi rotta) presenti in portafoglio. Calcola le quantità ESATTE affinché le minusvalenze compensino le plusvalenze → tasse ≈ 0. Output in tabella: | Titolo | Azioni da vendere | Plus/Minus € | Effetto fiscale |.
**d) DEPLOYMENT POLVERE SECCA (${fmtEUR.format(cashEur)}):** SOLO se VIX>20 o titoli in drawdown >15% → ordini limite millimetrici sui supporti (ticker, quantità, prezzo limite, priorità). Includi anche settori non-tech penalizzati (Value/Financials/Aerospace-Difesa/Banche) con ROIC>15%. Se non ci sono condizioni di "blood in the streets", scrivi esplicitamente "Liquidità CONSERVATA — nessun ingresso sui massimi".
**e) Nuovi ingressi da ricerca web** (NON in portafoglio): 2-3 idee con ticker, entry precisa, tesi in 2 righe, coerenti con mandato FASE 1→2.

## 4. RISCHI, COPERTURE & OUTLOOK
**Copertura portafoglio:** strategia opzioni low-cost (collar/put spread su QQQ o NDX) con strike e scadenza precisi, compatibile con Diamond Hands (copertura parziale, non totale). Muri opzioni (CW/PW) per titoli con dati disponibili → livelli pinning prossima scadenza.
**Rischi principali** (in ordine probabilità × impatto): top 3.
**Outlook:** BREVE (0-4 settimane) · MEDIO (1-3 mesi) · LUNGO (6-18 mesi) — direzione + livello chiave + probabilità %.
**Calendario eventi prossimi 30 giorni:** trimestrali, FOMC, BoJ, dati macro chiave.`);
  lines.push("");
  lines.push(`DATI AL ${new Date(DATA.updated_at).toLocaleString("it-IT")}`);
  const cashLine = t.cash ? ` · liquidità ${fmtEUR.format(t.cash)}` : "";
  lines.push(`SITUAZIONE PATRIMONIALE: patrimonio totale ${fmtEUR.format(Math.round(patrimonio))} (${(patrimonio/GOAL*100).toFixed(1)}% del target €1M, CAGR necessario ${cagrNeeded}%)${cashLine} · capitale investito (costo) ${fmtEUR.format(t.eur_cost ?? t.eur_invested)} · guadagno lordo ${signTxt(Math.round(t.eur_gain), " €")} (${signTxt(Math.round(t.eur_gain_pct * 100) / 100)})${t.eur_gain_net != null ? ` · netto tasse stimato ${signTxt(Math.round(t.eur_gain_net), " €")}` : ""}.`);
  lines.push("");
  lines.push("PORTAFOGLIO (controvalore e P&L reali per posizione; PMC = mie operazioni passate):");
  const f = (v, d = 2) => v === null || v === undefined ? "—" : fmtNum.format(v);
  const mdRow = (r) => {
    const c = cur(r);
    const optC = (DATA.options || {})[r.ticker];
    const optNote = optC ? `CW:${c}${f(optC.expiries?.[0]?.call_wall)} PW:${c}${f(optC.expiries?.[0]?.put_wall)}` : "—";
    const rsBench = r.rs_bench === "sox" ? "SOX" : r.rs_bench === "ndx" ? "NDX" : "S&P";
    const rsCell = r.rs_1m != null ? `${r.rs_1m > 0 ? "+" : ""}${r.rs_1m}% (vs ${rsBench})` : "—";
    return `| ${r.name} (${r.ticker}) | ${r.qty ? fmtNum.format(r.qty) : "—"} | ${r.qty ? c + f(r.pmc) : "—"} | ${c}${f(r.price)} | ${signTxt(r.change_pct)} | ${r.qty ? signTxt(r.gain_pct) : "—"} | ${r.rsi ?? "—"} | ${rsCell} | ${r.support ? c + f(r.support) : "—"} | ${r.resistance ? c + f(r.resistance) : "—"} | ${r.pe && r.pe > 0 ? f(r.pe) : "—"} | ${f(r.eps)} | ${f(r.beta)} | ${r.rating?.upside_pct != null ? signTxt(r.rating.upside_pct) : "—"} | ${r.earnings_date || "—"} | ${r.signal} | ${optNote} |`;
  };
  const head = "| Titolo | Qtà | PMC | Prezzo | Oggi | Guad.% | RSI | RS 1M (vs bench) | Supp. | Resist. | P/E | EPS | Beta | Target Δ | Trimestrale | Segnale | Opzioni (CW/PW) |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  lines.push(head); lines.push(sep);
  DATA.portfolio.forEach(r => lines.push(mdRow(r)));
  if ((DATA.watchlist || []).length) {
    lines.push("");
    lines.push("WATCHLIST (nessuna posizione):");
    lines.push(head); lines.push(sep);
    DATA.watchlist.forEach(r => lines.push(mdRow(r)));
  }
  lines.push("");
  // ANALISI FONDAMENTALE DETTAGLIATA per ticker
  const fundItems = [...DATA.portfolio, ...(DATA.watchlist || [])].filter(r => r.stats?.market_cap);
  if (fundItems.length) {
    lines.push("ANALISI FONDAMENTALE DETTAGLIATA (usa per sezione 3 — valutazione e qualità utili):");
    lines.push("| Titolo | P/E TTM | P/FCF | EV/EBITDA | ROE | Marg.netto | Cresc.ricavi | P/B | PEG | Div% | Note |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
    fundItems.forEach(r => {
      const st = r.stats || {};
      const pfcf = st.market_cap && st.fcf && st.fcf > 0 ? Math.round(st.market_cap / st.fcf * 10) / 10 : null;
      const peTtm2 = st.pe_ttm || r.pe;
      const fcfWarn = pfcf != null && peTtm2 > 0 && pfcf > peTtm2 * 2 ? " [!FCF]" : "";
      const roeTag = st.roe != null && st.roe > 0.15 ? " [ROIC>15%]" : "";
      const wlTag = DATA.portfolio.find(p => p.ticker === r.ticker) ? "" : " [WL]";
      lines.push(`| ${r.ticker}${wlTag} | ${peTtm2 > 0 ? fmtNum.format(Math.round(peTtm2 * 10) / 10) + "×" : "—"} | ${pfcf ? fmtNum.format(pfcf) + "×" + fcfWarn : "—"} | ${st.ev_ebitda ? fmtNum.format(Math.round(st.ev_ebitda * 10) / 10) + "×" : "—"} | ${st.roe ? pctOf(st.roe) + roeTag : "—"} | ${st.profit_margin ? pctPlain(st.profit_margin) : "—"} | ${st.revenue_growth ? pctOf(st.revenue_growth) : "—"} | ${st.price_to_book ? fmtNum.format(Math.round(st.price_to_book * 10) / 10) + "×" : "—"} | ${st.peg ? fmtNum.format(Math.round(st.peg * 100) / 100) : "—"} | ${st.dividend_yield ? pctPlain(st.dividend_yield) : "—"} | ${roeTag.trim()} ${fcfWarn.trim()} |`);
    });
    lines.push("([ROIC>15%]=qualità eccellente del capitale; [!FCF]=P/FCF >> P/E → controllare accrual/earnings quality; [WL]=watchlist)");
    lines.push("");
  }
  // contesto economia USA (stile Macrotrends): P/E mercato, tassi Fed, inflazione, PIL, curva
  const usEco = [];
  if (m.sp500_pe) usEco.push(`P/E S&P 500 ${m.sp500_pe.current}× (media 10A ${m.sp500_pe.avg_10y}×)${m.sp500_pe.nasdaq_pe ? `, P/E Nasdaq 100 ${m.sp500_pe.nasdaq_pe}×` : ""}`);
  if (m.fed_market) usEco.push(`tasso Fed ${m.fed_market.current_rate}%`);
  const cpiI = (m.indicators || []).find(i => i.key === "cpi");
  const pceI = (m.indicators || []).find(i => i.key === "pce");
  if (cpiI) usEco.push(`inflazione CPI ${cpiI.value}`);
  if (pceI) usEco.push(`PCE ${pceI.value}`);
  if (m.yield_recession?.gdp_last != null) usEco.push(`PIL reale YoY ${signTxt(m.yield_recession.gdp_last)}`);
  if (m.yield_recession?.current_curve != null) usEco.push(`curva 10A-2A ${signTxt(m.yield_recession.current_curve)} pp`);
  if (usEco.length) {
    lines.push("CONTESTO ECONOMIA USA (riferimento Macrotrends — usalo per calibrare rotazione settoriale e rischio del portafoglio):");
    lines.push("- " + usEco.join(" · "));
    lines.push("");
  }
  lines.push("QUADRO MACRO:");
  if (m.risk_sentiment) lines.push(`- Sentiment globale: ${m.risk_sentiment.label} (${m.risk_sentiment.score}/100)`);
  if (m.thermometer) lines.push(`- Termometro tecnico del portafoglio: ${m.thermometer.label} (${m.thermometer.score}/100)`);
  if (m.fear_greed) {
    let fgl = `- Fear & Greed: ${m.fear_greed.score} (${FG_LABELS[m.fear_greed.rating] || m.fear_greed.rating}), 1 settimana fa ${m.fear_greed.week_ago}, 1 mese fa ${m.fear_greed.month_ago}${m.fear_greed.year_ago ? `, 1 anno fa ${m.fear_greed.year_ago}` : ""}`;
    if ((m.fear_greed.components || []).length) fgl += ` [componenti: ${m.fear_greed.components.map(c => `${c.label} ${c.rating}${c.score != null ? ` ${c.score}` : ""}`).join("; ")}]`;
    lines.push(fgl);
  }
  if (m.vix) lines.push(`- VIX: ${m.vix.value} (${signTxt(m.vix.change_pct)} oggi)`);
  if (m.fedwatch) lines.push(`- Fed: range ${m.fedwatch.target_range}, tasso implicito futures ${m.fedwatch.implied_rate}%`);
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
  (m.markets || []).forEach(x => lines.push(`- ${x.label}: ${x.value} (${signTxt(x.change_pct, x.suffix || "%")} oggi)`));
  (m.indicators || []).forEach(i => lines.push(`- ${i.label}: ${i.value} (${i.date})`));
  if (m.macroquant) lines.push(`- MacroQuant (ciclo economico, stile BCA): ${m.macroquant.label} (${m.macroquant.score}/100)`);
  if (m.signposts) lines.push(`- BofA Bear-Market Signposts: ${m.signposts.active}/10 attivi (${m.signposts.pct}% rischio ribassista)`);
  if (m.credit) {
    let crl = `- Rischio Credito (HY OAS, proxy CDS): ${m.credit.spread_hy}% — ${m.credit.label} (score ${m.credit.score}/100; <4% normale, 5-7% stress, >9% crisi)`;
    const ch = m.credit.history || [];
    if (ch.length > 20) { const d = ch[ch.length - 1].v - ch[ch.length - 21].v; crl += `; trend ~1 mese ${d > 0 ? "+" : ""}${fmtNum.format(Math.round(d * 100) / 100)} pp (${d > 0.15 ? "spread in allargamento = rischio in aumento" : d < -0.15 ? "spread in restringimento = rischio in calo" : "stabile"})`; }
    lines.push(crl);
  }
  if (m.systemic_risk) {
    const sr = m.systemic_risk;
    lines.push(`- Rischio Sistemico & Credito (proxy CDS): HY OAS ${sr.hy_oas}% (${signTxt(sr.hy_chg_1m)} 1m), IG OAS ${sr.ig_oas ?? "—"}% (${sr.ig_chg_1m != null ? signTxt(sr.ig_chg_1m) : "—"} 1m), HY/IG ${sr.hy_ig ?? "—"}×${sr.stlfsi != null ? `, stress finanziario St.Louis ${signTxt(sr.stlfsi)}` : ""} — ${sr.status}`);
  }
  if (m.smart_money) {
    const sm = m.smart_money;
    let l = `- Istituzionali VS Retail: ${sm.label} (${sm.score}/100, basato su SMC di S&P 500 e Nasdaq + VIX term + HY/IG + put/call)`;
    const si = sm.smc_indices || {};
    const idxTxt = Object.values(si).map(s => `${s.label_idx}: struttura ${s.structure}, BOS ${s.bos || "n/d"}, FVG ${s.bull_fvg}↑/${s.bear_fvg}↓, bias ${s.bias}/100`).join(" · ");
    if (idxTxt) l += `. SMC indici → ${idxTxt}`;
    if (sm.vix_term_ratio != null) l += `. VIX/VIX3M ${fmtNum.format(sm.vix_term_ratio)} ${sm.vix_term_ratio > 1 ? "(backwardation=tensione)" : "(contango=calma)"}`;
    if (sm.hy_ig_ratio != null) l += `, HY/IG ${fmtNum.format(sm.hy_ig_ratio)}`;
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
    const gap = Math.round(m.decouple.sp500.slice(-1)[0].v - m.decouple.gdp.slice(-1)[0].v);
    lines.push(`- Disaccoppiamento S&P 500 vs PIL reale: gap ${gap > 0 ? "+" : ""}${gap} pp (>40 pp storicamente precede correzioni; quanta crescita è già prezzata)`);
  }
  if ((m.curve_history || []).length) {
    const cv = m.curve_history.slice(-1)[0].v;
    lines.push(`- Curva 10A-2A: ${cv > 0 ? "+" : ""}${cv} pp (${cv < 0 ? "ancora invertita = rischio recessione" : "tornata positiva dopo l'inversione = dis-inversione in corso"})`);
  }
  if (m.yield_recession) {
    const yr = m.yield_recession;
    lines.push(`- Curva vs Recessione (storico FRED): spread 10A-2A ${yr.current_curve != null ? (yr.current_curve > 0 ? "+" : "") + yr.current_curve + " pp" : "—"}${yr.curve_12m_ago != null ? ` (12m fa ${yr.curve_12m_ago > 0 ? "+" : ""}${yr.curve_12m_ago})` : ""}, ${yr.label}. PIL reale YoY ${yr.gdp_last != null ? yr.gdp_last + "%" : "—"}, sussidi disocc. ${yr.claims_last ?? "—"}. NB: irripidimento post-inversione → storicamente recessione entro ~12 mesi (curva shiftata di 12m anticipa il calo del PIL).`);
  }
  if (m.fedwatch && (m.fedwatch.meetings || []).length) lines.push(`- FedWatch prossima riunione ${m.fedwatch.meetings[0].date}: prob. taglio ${m.fedwatch.meetings[0].cut_prob}%`);
  if ((m.tilt || []).length) {
    lines.push("");
    lines.push("ROTAZIONE SETTORIALE/TEMATICA USA (ETF, performance 1M e 3M):");
    [...m.tilt].sort((a, b) => b.m1 - a.m1).forEach(s =>
      lines.push(`- ${s.name} (${s.ticker}): 1M ${signTxt(s.m1)}, 3M ${signTxt(s.m3)}`));
  }
  if (m.sp500_pe) {
    let peLine = `- P/E Ratio S&P 500 (FRED SP500PE): ${m.sp500_pe.current}× (${m.sp500_pe.label}) · media 10A ${m.sp500_pe.avg_10y}× · percentile storico ${m.sp500_pe.pct_rank}°`;
    if (m.sp500_pe.nasdaq_pe) peLine += ` · Nasdaq 100 (QQQ) P/E: ${m.sp500_pe.nasdaq_pe}× (tech solitamente a premio; >35× = valutazioni tese)`;
    lines.push(peLine);
  }
  if (m.corp_profit) {
    let cpBp = `- S&P 500 & Nasdaq 100 vs Profitti Aziendali Reali (FRED CP): S&P gap ${m.corp_profit.gap > 0 ? "+" : ""}${m.corp_profit.gap} pp`;
    if (m.corp_profit.ndx_gap != null) cpBp += `, NDX gap ${m.corp_profit.ndx_gap > 0 ? "+" : ""}${m.corp_profit.ndx_gap} pp`;
    cpBp += ` — ${m.corp_profit.label} (score ${m.corp_profit.score}/100; gap>40 = Asset Inflation da fiat debasement, non crescita utili reali)`;
    lines.push(cpBp);
  }
  if (m.fed_market) lines.push(`- Fed Funds Rate attuale: ${m.fed_market.current_rate}% (rilevazione ${m.fed_market.rate_date}); tasso>4% storicamente comprime i multipli P/E in 12-18 mesi`);
  if (m.witching) lines.push(`- Prossime "4 streghe" (quadruple witching): ${new Date(m.witching.next).toLocaleDateString("it-IT")} (tra ${m.witching.days} gg)`);
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
    lines.push(`- Concentrazione per settore: ${secs.join(" · ")} (portafoglio fortemente sbilanciato sul tech/semi → priorità al de-risking)`);
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
  if (t.cash) lines.push(`- Liquidità disponibile: ${fmtEUR.format(t.cash)} · capitale investito: ${fmtEUR.format(t.eur_invested)}`);
  if ((DATA.top_caps || []).length) {
    lines.push("");
    lines.push("TOP 10 CAPITALIZZAZIONI MONDIALI:");
    DATA.top_caps.forEach((x, i) => lines.push(`${i + 1}. ${x.name} (${x.ticker}): ${fmtMcap(x.mcap_usd)} (${signTxt(x.change_pct)} oggi)`));
  }
  if ((DATA.top_etfs || []).length) {
    lines.push("");
    lines.push("TOP 10 ETF (metriche di valutazione e segnali di ingresso):");
    lines.push("| ETF | Nome | Prezzo | Oggi | 1M | RSI | P/E | Div% | AUM | Segnale |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|");
    DATA.top_etfs.forEach(r => {
      const m1 = r.sparks?.m1;
      const m1v = m1?.length >= 2 && m1[0] ? ((m1[m1.length-1]/m1[0]-1)*100).toFixed(1) : "—";
      const opp = etfOpportunity(r.rsi);
      lines.push(`| ${r.ticker} | ${r.name} | $${fmtNum.format(r.price || 0)} | ${signTxt(r.change_pct)} | ${m1v !== "—" ? signTxt(+m1v) : "—"} | ${r.rsi ?? "—"} | ${r.pe ?? "—"} | ${r.div_yield ? r.div_yield+"%" : "—"} | ${r.aum ? "$"+r.aum+"B" : "—"} | ${opp.label} |`);
    });
    lines.push("(RSI<35=ipervenduto/possibile ingresso; RSI>70=ipercomprato/attendere; valuta rotazione settoriale e de-risking tech con questi ETF)");
  }
  if ((DATA.predictions || []).length) {
    lines.push("");
    lines.push("MERCATI DI PREVISIONE (Polymarket, prob. Sì):");
    DATA.predictions.forEach(p => lines.push(`- ${p.question}: ${p.yes}%`));
  }
  lines.push("");
  lines.push("ULTIME NEWS (sentiment | titolo | fonte):");
  (DATA.news || []).slice(0, 18).forEach(n => {
    const s = n.sentiment === "bull" ? "[POS]" : n.sentiment === "bear" ? "[NEG]" : "[NEU]";
    lines.push(`- ${s} [${n.tickers.join(",")}] ${n.title} (${n.source})`);
  });
  lines.push("");
  // news per singolo ticker (incrocio)
  const allTickers2 = [...DATA.portfolio.map(r => r.ticker), ...(DATA.watchlist || []).map(r => r.ticker)];
  const tkNews = {};
  (DATA.news || []).forEach(n => {
    (n.tickers || []).forEach(tk => {
      if (allTickers2.includes(tk)) {
        if (!tkNews[tk]) tkNews[tk] = [];
        if (tkNews[tk].length < 3) tkNews[tk].push(n);
      }
    });
  });
  const tkNewsKeys = Object.keys(tkNews);
  if (tkNewsKeys.length) {
    lines.push("");
    lines.push("NEWS RILEVANTI PER SINGOLO TITOLO (usa per valutare catalizzatori e rischi specifici — sezioni 2 e 3):");
    tkNewsKeys.forEach(tk => {
      tkNews[tk].forEach(n => {
        const s2 = n.sentiment === "bull" ? "[+]" : n.sentiment === "bear" ? "[-]" : "[~]";
        lines.push(`  ${tk}: ${s2} ${n.title} (${n.source})`);
      });
    });
  }
  lines.push("");
  lines.push(`ROTAZIONE & DE-RISKING SEMICONDUTTORI (direttiva esplicita): Analizza l'attuale andamento dei macro-settori (vedi dati ROTAZIONE SETTORIALE sopra). Avendo necessità di effettuare un de-risking sui semiconduttori, crea un piano di rotazione del mio portafoglio basato sulla mia liquidità disponibile (${fmtEUR.format(cashEur)}). Indicami 2-3 ticker alternativi specifici (value o difensivi, oppure FASE 2 AI: Software/Cloud/Cybersecurity/Biotech) per riequilibrare l'assetto, fornendo i relativi prezzi limite d'ingresso.`);
  lines.push("");
  lines.push(`ISTRUZIONI FINALI DI FORMATO:
Rispondi come UN UNICO REPORT PROFESSIONALE (non come dialogo tra analisti) con la freddezza tattica di un hedge fund. Usa le 5 sezioni numerate indicate. Per ogni dato quantitativo che citi, indica il valore preciso. Per ogni raccomandazione operativa: TICKER + N AZIONI + PREZZO LIMITE + MOTIVAZIONE IN UNA RIGA. Alla fine aggiungi una sezione SINTESI ESECUTIVA di max 5 bullet point con le 5 azioni più urgenti da fare oggi/questa settimana, ordinate per priorità.

VINCOLI MANDATO + 4 PILASTRI ISTITUZIONALI (NON DEROGABILI):
- CAGR target: ${cagrNeeded}% annuo → ogni raccomandazione deve essere coerente con questo obiettivo
- Diamond Hands: NON suggerire uscite per volatilità normale (-20/-30%)
- ① Scale-Out: mai uscite binarie totali → TRIMMING parziale 25-50% (Free Ride) su multipli tossici/earnings binari, non liquidazione completa
- ② Tax Alpha: ogni plusvalenza va abbinata a minusvalenze di aziende zombie (ROIC<0) per azzerare le tasse 26%
- ③ Moonshot: titoli con catalizzatore governativo/macro/AI vanno mantenuti anche se i bilanci sono deboli
- ④ Polvere secca (${fmtEUR.format(cashEur)}): deploy SOLO su VIX>20 o drawdown>15%, con radar multi-settoriale (anche non-tech: Value/Financials/Difesa/Banche, ROIC>15%). Altrimenti CONSERVA.
- Fase 2 AI: rotazione anticipata verso Software AI / Cloud / Cybersecurity / Biotech AI per il 2026-2028

Conferma in apertura del report di aver integrato questi 4 protocolli istituzionali, poi procedi con l'analisi.`);
  return lines.join("\n");
}

function toast(msg) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

async function showPrompt() {
  const text = buildPrompt();
  $("#prompt-text").value = text;
  $("#modal").hidden = false;
  try {
    await navigator.clipboard.writeText(text);
    toast("Prompt copiato negli appunti ✓");
  } catch { /* clipboard non disponibile: l'utente può copiare dal box */ }
}

/* ---------------- eventi ---------------- */
$("#btn-refresh").addEventListener("click", refreshAll);
$("#btn-prompt").addEventListener("click", showPrompt);
$("#modal-close").addEventListener("click", () => { $("#modal").hidden = true; });
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("#modal").hidden = true; });
$("#btn-copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("#prompt-text").value);
  toast("Copiato ✓");
});
/* ---------------- calcolo vendite (plus/minusvalenze) ---------------- */
function sellRows() {
  const eur = DATA.eurusd || 1.08;
  return DATA.portfolio.map(r => {
    const toEur = r.currency === "EUR" ? 1 : 1 / eur;
    const plPerShare = (r.price - r.pmc) * toEur;   // utile/perdita per azione in €
    return { ...r, plPerShare, taxRate: r.ticker === "BTP-V28" ? 0.125 : 0.26 };
  });
}

function renderSellCalc() {
  const rows = sellRows();
  $("#sell-table tbody").innerHTML = rows.map(r => {
    const c = cur(r);
    const qty = r.ticker === "BTP-V28" ? r.qty : r.qty;
    return `<tr data-tk="${r.ticker}">
      <td class="name-cell">${r.name}<span class="tk">${r.ticker}</span></td>
      <td class="num">${fmtNum.format(r.qty)}</td>
      <td class="num">${c}${fmtNum.format(r.pmc)}</td>
      <td class="num">${c}${fmtNum.format(r.price)}</td>
      <td class="num"><input type="number" class="sell-in" data-tk="${r.ticker}" min="0" max="${r.qty}" step="any" placeholder="0" style="width:90px"></td>
      <td class="num sell-pl" data-tk="${r.ticker}">—</td>
    </tr>`;
  }).join("");
  document.querySelectorAll(".sell-in").forEach(i => i.addEventListener("input", computeSell));
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
    cell.textContent = q ? signTxt(Math.round(pl), " €") : "—";
    cell.className = `num sell-pl ${signCls(pl)}`;
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
$("#signposts-box").addEventListener("click", openSignpostsModal);
$("#tilt-box").addEventListener("click", openTiltModal);
$("#portfolio-health").addEventListener("click", openHealthModal);
$("#macroquant-box").addEventListener("click", openMacroQuantModal);
$("#seasonality-box").addEventListener("click", openSeasonalityModal);
$("#market-direction").addEventListener("click", () => {
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
  if (fh) { openFinancialsModal(fh.dataset.fin); return; }
  const fr = e.target.closest(".fund-row");            // riga vista fondamentale → conto economico + statistiche
  if (fr) { openFinancialsModal(fr.dataset.fundTk); return; }
  const sc = e.target.closest(".stat-cell");           // click su una metrica → spiegazione
  if (sc) { toast(sc.dataset.info); return; }
  const bb = e.target.closest(".beta-btn");            // click su Beta → simulatore drawdown
  if (bb) { openBetaSimulator(); return; }
  const rc = e.target.closest(".rs-cell");             // click su RS 1M → spiegazione forza relativa
  if (rc && rc.dataset.rsTk) { openRsInfo(rc.dataset.rsTk); return; }
  const shc = e.target.closest(".sharpe-cell");        // click su Sharpe 1A → spiegazione
  if (shc && shc.dataset.sharpeTk) { openSharpeInfo(shc.dataset.sharpeTk); return; }
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
    syncSparkToggles();
    renderTable();
    renderWatchlist();
  });
});
$("#wl-add-top").addEventListener("click", addWatchlist);
document.querySelectorAll("#view-toggle .chip").forEach(ch =>
  ch.addEventListener("click", () => setPtfView(ch.dataset.view)));
document.querySelectorAll("#wl-view-toggle .chip").forEach(ch =>
  ch.addEventListener("click", () => setWlView(ch.dataset.view)));
document.querySelectorAll("#hist-toggle .chip").forEach(ch => {
  ch.addEventListener("click", () => {
    document.querySelectorAll("#hist-toggle .chip").forEach(c => c.classList.remove("chip-active"));
    ch.classList.add("chip-active");
    histRange = ch.dataset.range;
    renderHistory();
  });
});
$("#bench-select").addEventListener("change", (e) => { histBenchKey = e.target.value; renderHistory(); });
document.querySelectorAll("#alloc-toggle .chip").forEach(ch => {
  ch.addEventListener("click", () => {
    document.querySelectorAll("#alloc-toggle .chip").forEach(c => c.classList.remove("chip-active"));
    ch.classList.add("chip-active");
    allocMode = ch.dataset.mode;
    renderAllocation();
  });
});

/* zoom grafici */
$("#hist-zoom").addEventListener("click", () => {
  const h = DATA.history && DATA.history[histRange];
  if (h) openChartModal(`Andamento portafoglio — ${histRange.toUpperCase()}`, h.values, h.dates, v => fmtEUR.format(Math.round(v)));
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

/* modifica posizioni */
$("#ptf-edit").addEventListener("click", () => {
  editMode.portfolio = !editMode.portfolio;
  $("#ptf-edit").classList.toggle("chip-active", editMode.portfolio);
  renderTable();
});
$("#wl-edit").addEventListener("click", () => {
  editMode.watchlist = !editMode.watchlist;
  $("#wl-edit").classList.toggle("chip-active", editMode.watchlist);
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
  $("#pmc-calc").scrollIntoView({ behavior: "smooth" });
  toast(`${ticker} caricato nel calcolatore PMC — inserisci la quantità da simulare`);
}

initSorting("ptf-table", renderTable);
initSorting("wl-table", renderWatchlist);

loadData();
// ricarica completa (tecnici, news, storico) ogni 5 minuti
setInterval(() => loadData(), 5 * 60 * 1000);
// prezzi live ogni 60 secondi
setInterval(() => livePrices(), 60 * 1000);
