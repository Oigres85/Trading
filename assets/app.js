/* Trading Dashboard — rendering lato client di data/data.json */
const REPO = "Oigres85/Trading";
let DATA = null;
let sparkRange = "m1";   // 1G | 1M | 1A

/* ordinamento tabelle: click su intestazione → desc → asc → default */
const SORT_FIELDS = {
  // colonne attuali (senza "Valore" e "Max storico")
  "ptf-table": ["name", "qty", "pmc", "change_pct", "change_pct", "prepost_chg", "volume",
                "gain", "gain_pct", "pe", "eps", "beta", "support",
                "resistance", "rsi", "vol_ratio", "health", "upside_pct", "upside_pct", "fin_health", null],
  "wl-table": ["name", "change_pct", "change_pct", "prepost_chg", "volume", "pe", "eps",
               "beta", "support", "resistance", "rsi", "vol_ratio",
               "health", "upside_pct", "upside_pct", "fin_health", null],
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

/* Aggiorna: prezzi live all'istante + rigenerazione completa via workflow (col token,
   chiesto una sola volta). Senza token resta comunque utile (prezzi live + reload). */
async function refreshAll() {
  const btn = $("#btn-refresh");
  btn.classList.add("spinning");
  btn.textContent = "⏳ Aggiorno…";
  try {
    livePrices();              // prezzi correnti subito (non blocca)
    const token = getToken();
    if (!token) { await loadData(false); toast("Prezzi aggiornati ✓ (token assente: niente rigenerazione completa)"); return; }
    const res = await dispatchWorkflow(token);
    if ([401, 403, 404].includes(res.status)) {
      localStorage.removeItem("gh_token");
      toast("Token senza permesso Actions — rimosso. Creane uno con Actions: read & write e riprova");
      return;
    }
    if (res.status !== 204) { toast(`Errore avvio aggiornamento (HTTP ${res.status})`); return; }
    btn.textContent = "⏳ Rigenero…";
    toast("Rigenerazione avviata — nuovi dati tra ~2-3 minuti");
    if (await waitForNewData(DATA?.updated_at)) toast("Dati rigenerati ✓");
    else toast("Ancora in corso — i dati arriveranno a breve");
  } catch (e) {
    console.error(e);
    toast("Errore durante l'aggiornamento");
  } finally {
    btn.classList.remove("spinning");
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
  renderTable(); fillLivePrice(row, () => { recomputeTotals(); renderKPI(); renderTable(); renderAllocation(); });
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
  return {
    ticker, name: ticker, currency, price: null, change_pct: null,
    value: 0, gain: 0, gain_pct: null, pe: null, eps: null, beta: null,
    ath: null, ath_dist_pct: null, support: null, resistance: null, rsi: null,
    volume: null, vol_ratio: null, signal: "in caricamento…", signal_class: "neutral",
    sparks: {}, tech_by_range: {}, rating: null, prepost: null, stats: null,
    earnings_date: null, fin_health: null, sector: "—", _loading: true, ...extra,
  };
}

function fillLivePrice(row, after) {
  fetchQuote(row.ticker).then(q => {
    if (!q) return;
    row.price = Math.round(q.price * 100) / 100;
    row.change_pct = Math.round((q.price / q.prev - 1) * 10000) / 100;
    if (row.currency === "USD" && row.qty) {
      row.value = row.price * row.qty;
      row.gain = row.value - row.pmc * row.qty;
      row.gain_pct = Math.round((row.value / (row.pmc * row.qty) - 1) * 10000) / 100;
    }
    row._loading = false;
    if (after) after();
  });
}

function removeHolding(section, ticker) {
  if (!window.confirm(`Rimuovere ${ticker} da ${section === "portfolio" ? "portafoglio" : "watchlist"}?`)) return;
  // rimozione ottimistica immediata
  DATA[section] = (DATA[section] || []).filter(p => p.ticker !== ticker);
  if (section === "portfolio") { recomputeTotals(); renderKPI(); renderTable(); renderAllocation(); }
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
  const eq = DATA.portfolio.filter(r => r.currency === "USD");
  const btp = DATA.portfolio.find(r => r.ticker === "BTP-V28");
  const usdValue = eq.reduce((s, r) => s + r.value, 0);
  const usdCost = eq.reduce((s, r) => s + r.pmc * r.qty, 0);
  const eurusd = DATA.eurusd || 1.08;
  const btpVal = btp ? btp.value : 0, btpGain = btp ? btp.gain : 0;
  const investedEur = usdValue / eurusd + btpVal;
  const totalEur = investedEur + cashEur;          // include la liquidità
  const costEur = usdCost / eurusd + (btp ? btp.pmc * btp.qty / 100 : 0);
  const eurGain = investedEur - costEur;           // il guadagno è solo sull'investito
  const tax = 0.26 * Math.max(0, (usdValue - usdCost) / eurusd) + 0.125 * Math.max(0, btpGain);
  Object.assign(DATA.totals, {
    usd_value: usdValue, usd_gain: usdValue - usdCost, usd_gain_pct: (usdValue / usdCost - 1) * 100,
    eur_value: totalEur, eur_invested: investedEur, eur_cost: costEur, cash: cashEur,
    eur_gain: eurGain, eur_gain_pct: (investedEur / costEur - 1) * 100,
    tax_est: tax, eur_gain_net: eurGain - tax,
  });
  DATA.allocation = DATA.portfolio.map(r => ({
    ticker: r.ticker, name: r.name, sector: r.sector || "Altro",
    value_eur: r.currency === "EUR" ? r.value : r.value / eurusd,
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
    const top = tilt[0], bot = tilt[tilt.length - 1];
    tBox.innerHTML = `<div class="mc-title">Rotazione settoriale (Tilt)</div>
      ${compactSemiGauge(top.score, ["Difensivo", "Aggressivo"])}
      <div class="mc-value">Sovrappeso: <b style="color:var(--green)">${esc(top.name)}</b> ${signTxt(top.m1)}</div>
      <div class="mc-sub muted">debole: ${esc(bot.name)} ${signTxt(bot.m1)} · clicca per il dettaglio</div>`;
  }
  // Quadruple Witching (4 streghe) con rating-bar prossimità
  const w = m.witching, wBox = $("#witching-box");
  if (wBox && w && w.next) {
    // urgenza 0-100: a 0 gg = 100 (massima), a 90+ gg = 0
    const urgency = Math.max(0, Math.min(100, Math.round((1 - w.days / 90) * 100)));
    const urgLab = w.days <= 7 ? "IMMINENTE" : w.days <= 21 ? "VICINA" : w.days <= 45 ? "IN ARRIVO" : "LONTANA";
    const urgColor = w.days <= 7 ? "var(--red)" : w.days <= 21 ? "var(--yellow)" : "var(--muted)";
    wBox.innerHTML = `<div class="mc-title">Quadruple Witching (4 streghe)</div>
      <div class="mc-value">${new Date(w.next).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" })}</div>
      <div class="meter-track" style="margin:4px 0"><span class="meter-fill" style="width:${urgency}%;background:${urgColor}"></span></div>
      <div class="mc-sub muted">tra ${w.days} gg · <b style="color:${urgColor}">${urgLab}</b> · clicca per dettagli</div>`;
  }
  // MacroQuant (stile BCA)
  const mq = m.macroquant, mqBox = $("#macroquant-box");
  if (mqBox && mq) {
    mqBox.innerHTML = `<div class="mc-title">MacroQuant (stile BCA)</div>
      ${compactSemiGauge(mq.score, ["Contrazione", "Espansione"])}
      <div class="mc-value" style="color:${scoreColor(mq.score)}">${mq.score}% · ${mq.label}</div>
      <div class="mc-sub muted">composito ciclo economico · clicca per il dettaglio</div>`;
  }
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
  const groups = {};
  tilt.forEach(s => { (groups[s.group || "Settori"] = groups[s.group || "Settori"] || []).push(s); });
  const heat = Object.entries(groups).map(([g, arr]) => `
    <div class="rot-group"><div class="rot-group-title">${esc(g)}</div>
      <div class="rot-tiles">${arr.sort((a, b) => b.m1 - a.m1).map(s => `
        <div class="rot-tile" style="background:${perfColor(s.m1)}" title="${esc(s.name)} (${s.ticker}) · 1M ${signTxt(s.m1)} · 3M ${signTxt(s.m3)}">
          <span class="rt-name">${esc(s.name)}</span><span class="rt-pct">${signTxt(s.m1)}</span></div>`).join("")}</div>
    </div>`).join("");
  const sorted = [...tilt].sort((a, b) => b.m1 - a.m1);
  const maxAbs = Math.max(...sorted.map(s => Math.abs(s.m1)), 1);
  const hist = sorted.map(s => `<div class="rot-bar-row">
      <span class="rot-bar-lab">${esc(s.name)} <span class="tk">${s.ticker}</span></span>
      <span class="rot-bar-track"><span class="rot-bar-fill" style="width:${Math.abs(s.m1) / maxAbs * 100}%;background:${perfColor(s.m1)}"></span></span>
      <span class="rot-bar-val ${signCls(s.m1)}">${signTxt(s.m1)}</span></div>`).join("");
  return `<div class="rot-heatmap">${heat}</div>
    <h4 style="margin:10px 0 4px">Performance 1 mese (ETF)</h4><div class="rot-hist">${hist}</div>`;
}

function openMacroQuantModal() {
  const mq = (DATA.macro || {}).macroquant;
  if (!mq) return;
  const rows = (mq.components || []).map(c =>
    `<tr><td>${esc(c.label)}</td><td style="min-width:120px">${meterBar(c.score, scoreColor(c.score), String(c.score))}</td></tr>`).join("");
  openInfoModal(`MacroQuant (stile BCA) — ${mq.score}% · ${mq.label}`,
    `<p class="muted" style="margin:0 0 8px">${esc(mq.note || "")}</p>
     <div class="info-line">Punteggio: <b style="color:${scoreColor(mq.score)}">${mq.score}/100</b> (alto = ciclo espansivo/risk-on, basso = rischio recessione).</div>
     <h4 style="margin:10px 0 4px">Componenti</h4>
     <table class="info-table"><tbody>${rows}</tbody></table>`);
}

function openTiltModal() {
  const tilt = (DATA.macro || {}).tilt;
  if (!tilt || !tilt.length) return;
  const byM1 = [...tilt].sort((a, b) => b.m1 - a.m1);
  const lead = byM1.slice(0, 3), lag = byM1.slice(-3).reverse();
  const defensives = ["Utilities", "Consumi difens.", "Salute", "Oro"];
  const defAvg = avg(tilt.filter(s => defensives.includes(s.name)).map(s => s.m1));
  const tech = tilt.find(s => s.ticker === "XLK");
  let regime = "—";
  if (defAvg != null && tech) regime = defAvg > tech.m1 ? "DIFENSIVO — i difensivi battono il Tech (cautela / de-risking)" : "PRO-RISCHIO — ciclici e Tech guidano";
  openInfoModal("Rotazione settoriale & tematica USA",
    `<div class="info-line"><b>Regime:</b> ${regime}</div>
     <div class="info-line"><b>Forti:</b> ${lead.map(s => `${esc(s.name)} ${signTxt(s.m1)}`).join(" · ")}</div>
     <div class="info-line"><b>Deboli:</b> ${lag.map(s => `${esc(s.name)} ${signTxt(s.m1)}`).join(" · ")}</div>
     ${rotationDetailHtml()}
     <div class="info-line muted" style="margin-top:8px">Momentum 1M/3M degli ETF (Yahoo Finance). Verde = forza, rosso = debolezza.</div>`);
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
  // opzioni portafoglio: Call/Put Wall per context
  const ptf = DATA.portfolio || [];
  const optContext = ptf.filter(r => DATA.options?.[r.ticker]).slice(0, 4).map(r => {
    const ex = DATA.options[r.ticker]?.expiries?.[0];
    return ex ? `<tr><td><b>${r.ticker}</b></td><td class="pos">${cur(r)}${fmtNum.format(ex.call_wall || 0)}</td><td class="neg">${cur(r)}${fmtNum.format(ex.put_wall || 0)}</td></tr>` : "";
  }).join("");
  openInfoModal("Quadruple Witching — le quattro streghe",
    `<p class="muted" style="margin:0 0 8px">Quattro volte l'anno (3° venerdì di marzo, giugno, settembre, dicembre) scadono contemporaneamente quattro tipi di derivati: spesso aumentano volumi e volatilità del 30-50% rispetto alla media giornaliera.</p>
     <div class="info-line"><b>Prossima:</b> <b style="color:${urgCol}">${w.next ? new Date(w.next).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }) : "—"}</b> (tra ${w.days} giorni)</div>
     <div class="meter-track" style="margin:6px 0"><span class="meter-fill" style="width:${urgency}%;background:${urgCol}"></span></div>
     <div class="info-line" style="color:${urgCol};font-size:12px;margin-bottom:10px">${urgLab}</div>
     <h4 style="margin:10px 0 4px">Impatto storico sulle opzioni del portafoglio</h4>
     <div class="info-line muted" style="font-size:11px;margin-bottom:6px">I market maker devono coprire/chiudere posizioni in scadenza → volumi straordinari intorno a Call Wall e Put Wall, spesso con "pinning" del prezzo ai livelli di maggiore open interest.</div>
     ${optContext ? `<table class="info-table"><thead><tr><th>Titolo</th><th>Call Wall</th><th>Put Wall</th></tr></thead><tbody>${optContext}</tbody></table>` : ""}
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
  let invested, controvalore, gain, gainPct, net, src;
  if (b && b.controvalore_investimenti) {
    // controvalore REALE degli investimenti (azioni + BTP), liquidità ESCLUSA
    controvalore = b.controvalore_investimenti;
    invested = b.investimenti;                       // capitale investito (costo)
    gain = controvalore - invested;                  // guadagno = valore attuale − costo
    gainPct = invested ? gain / invested * 100 : 0;
    const btpVal = b.controvalore_btp || 0;
    const btpGain = btpVal - 40000;                  // BTP: nominale 40k
    const equityGain = gain - btpGain;               // resto = azioni
    const tax = 0.26 * Math.max(0, equityGain) + 0.125 * Math.max(0, btpGain);
    net = gain - tax;
    src = `dati broker · agg. ${new Date(b.as_of).toLocaleDateString("it-IT")}`;
  } else {
    invested = t.eur_invested; controvalore = t.eur_value; gain = t.eur_gain;
    gainPct = t.eur_gain_pct; net = t.eur_gain_net ?? t.eur_gain; src = "stima dai prezzi";
  }
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

  $("#kpi-grid").innerHTML = kpis.map(k => `
    <div class="kpi" style="--accent:${k.accent}">
      <div class="label">${k.label}</div>
      <div class="value ${k.valueCls || ""}">${k.value}</div>
      <div class="sub ${k.subCls || ""}">${k.sub || ""}</div>
    </div>`).join("");
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
    h = { dates: oldDates.concat(ec.map(p => p.d)), values: oldVals.concat(ec.map(p => p.v)) };
    realCurve = true;
  }
  const box = $("#hist-chart");
  if (!h || h.values.length < 2) { box.innerHTML = '<div class="muted" style="padding:40px 0;text-align:center">Storico non disponibile</div>'; $("#hist-summary").textContent = ""; return; }
  const vals = h.values, dates = h.dates;
  const bench = (!realCurve && histBenchKey !== "none" && h[histBenchKey] && h[histBenchKey].length === vals.length) ? h[histBenchKey] : null;
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

function betaBar(beta) {
  if (beta === null || beta === undefined) return "—";   // beta basso = verde (meno rischio)
  return meterBar(Math.min(beta, 3) / 3 * 100, scoreColor(clamp(100 - (beta - 0.5) * 55)), fmtNum.format(beta));
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

function techCells(r) {
  const c = cur(r);
  // supporto/resistenza cambiano con il range selezionato (1S/1M/3M/1A)
  const tw = (r.tech_by_range || {})[sparkRange];
  const support = tw ? tw.support : r.support;
  const resistance = tw ? tw.resistance : r.resistance;
  return `
      <td class="num">${peBar(r.pe)}</td>
      <td class="num">${epsBar(r.eps)}</td>
      <td class="num">${betaBar(r.beta)}</td>
      <td class="num">${support ? c + fmtNum.format(support) : "—"}</td>
      <td class="num">${resistance ? c + fmtNum.format(resistance) : "—"}</td>
      <td class="num">${rsiBar(r.rsi)}</td>
      <td class="num">${volBar(r.vol_ratio)}</td>
      <td class="num">${rsBar(r.rs_1m, r.rs_bench)}</td>
      <td><span class="badge ${r.signal_class}">${r.signal}</span></td>
      <td>${ratingBadge(r.rating)}</td>
      <td class="num">${targetBar(r.rating)}</td>
      <td class="num">${finHealthBar(r)}</td>
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

async function drawTickerChart() {
  const all = [...(DATA.portfolio || []), ...(DATA.watchlist || [])];
  const r = all.find(x => x.ticker === cmTicker);
  if (!r) return;
  const sym = r.currency === "PTS" ? "" : r.currency === "EUR" ? "€" : "$";
  const tv = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(r.ticker.replace("^", ""))}`;
  const controls = `<div class="cm-controls"><div class="spark-toggle cm-ranges">` +
    CM_RANGES.map(([k, lab]) => `<button class="chip cm-range ${k === cmRange ? "chip-active" : ""}" data-range="${k}">${lab}</button>`).join("") +
    `</div>${hasOptions(r.ticker) ? `<button class="btn btn-ghost btn-sm cm-opt-open">Catena opzioni</button>` : ""}<a class="btn btn-ghost btn-sm" href="${tv}" target="_blank" rel="noopener">Apri su TradingView ↗</a></div>`;
  $("#chart-modal-title").textContent = `${r.name} (${r.ticker})`;
  $("#chart-modal-body").innerHTML = controls + `<div class="muted" style="padding:40px 0;text-align:center" id="cm-loading">Carico le candele…</div>`;
  $("#chart-modal-tip").innerHTML = "";
  $("#chart-modal").hidden = false;
  const [yr, yi] = CM_YF[cmRange] || ["1mo", "1d"];
  const ohlc = await fetchOHLC(r.ticker, yr, yi);
  if (cmTicker !== r.ticker) return;          // l'utente ha cambiato nel frattempo
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
  $("#chart-modal-title").textContent = `Catena opzioni — ${r.name || r.ticker} (${r.ticker})`;
  $("#chart-modal-tip").innerHTML = "";
  $("#chart-modal").hidden = false;
  renderOptionsContent();
}

function loadOptionsView() { renderOptionsContent(); }   // re-render (toggle/scadenza)

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

  $("#chart-modal-body").innerHTML = controls + impactHtml + `
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
  sentiment: ["Sentiment globale", "Indicatore composito risk-on/risk-off.", "Aggiornato a ogni refresh", /sentiment|risk|rally|selloff|market/i],
  buffett: ["Buffett Indicator", "Capitalizzazione totale del mercato USA rapportata al PIL: sopra ~150% storicamente indica sopravvalutazione.", "Aggiornato a ogni refresh", /valuation|buffett|overvalu|gdp|market cap|bolla|bubble/i],
  thermometer: ["Termometro portafoglio", "Media della salute tecnica (RSI, trend, momentum) dei tuoi titoli.", "Aggiornato a ogni refresh", /(?!)/],
  credit: ["Rischio Credito (HY OAS)", "Spread dei bond High Yield rispetto ai Treasury USA: proxy del rischio sistemico, analogo al mercato CDS senza costi di abbonamento. Fonte: ICE BofA via FRED.", "Giornaliero (FRED)", /credit|credito|spread|hy|high.?yield|cds|default|obbligaz|bond/i],
  decouple: ["Disaccoppiamento Macro", "Divergenza tra mercato azionario (S&P 500) e economia reale (PIL reale USA GDPC1): misura quanta crescita futura è già prezzata nella borsa. Entrambe le serie normalizzate a 100 all'inizio del periodo.", "Mensile/trimestrale (FRED)", /disaccopp|decoupl|valuation|bolla|bubble|pil|gdp|utili|profit|crescita/i],
  smart_money: ["Smart Money vs Retail", "Posizionamento istituzionale dedotto da segnali professionali: struttura a termine del VIX (VIX/VIX3M), spread credito HY/IG e copertura put/call. Confrontato col Fear & Greed (proxy del sentiment retail) per evidenziare le divergenze tra denaro intelligente e folla.", "Aggiornato a ogni refresh", /smart.?money|istituzional|institution|hedge.?fund|posizionament|flow|flussi|put.?call|vix/i],
  sp500_pe: ["P/E Ratio Storico S&P 500", "Rapporto Prezzo/Utili dell'S&P 500 su base mensile (FRED SP500PE). Mostra se il mercato è sopravvalutato rispetto alla media storica. P/E > 25 indica valutazioni tese; P/E > 35 livelli estremi. La percentile di rango storico indica quante volte negli ultimi 10 anni il mercato è stato più economico di adesso.", "Mensile (FRED SP500PE)", /p\/e|price.?earning|multiplo|valutaz|sopravvalut|cape|shiller/i],
  corp_profit: ["S&P 500 vs Profitti Aziendali Reali", "Divergenza tra l'S&P 500 nominale e i profitti aziendali reali USA (FRED CP). Un gap ampio segnala Asset Inflation: la borsa cresce più degli utili reali, trainata da svalutazione monetaria (fiat debasement) e non da crescita economica. Storicamente gap >40 pp precede lateralizzazioni o correzioni.", "Trimestrale (FRED CP + SP500 mensile)", /profitti|profit|asset.?inflat|nominal|real.?earn|corp|aziend|deflat/i],
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
    extra = `<div class="info-line"><b>Posizionamento istituzionale:</b> <span style="color:${smCol}">${sm.score}/100 — ${sm.label}</span></div>
      ${thermoBar(sm.score, ["Difensivo", "Aggressivo"])}`;
    if (sm.divergence != null) {
      const dvCol = Math.abs(sm.divergence) > 15 ? "var(--yellow)" : "var(--green)";
      const fg = m.fear_greed?.score;
      extra += `<div class="info-line" style="margin-top:8px"><b>Divergenza con il retail:</b> <span style="color:${dvCol}">${sm.divergence > 0 ? "+" : ""}${sm.divergence} pt — ${sm.divergence_label}</span></div>
        <div class="info-line muted" style="font-size:11px">Fear &amp; Greed (retail) ${fg ?? "—"} vs Smart Money ${sm.score}. Un gap ampio segnala possibile inversione: quando il retail è euforico ma gli istituzionali si coprono, storicamente precede correzioni.</div>`;
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
    extra = `<div class="info-line"><b>Gap S&amp;P vs Profitti Reali:</b> <span style="color:${gapCol}">+${cp.gap} pp — ${cp.label}</span></div>
      ${thermoBar(cp.score, ["Allineati", "Asset Inflation"])}
      <div class="info-line muted" style="font-size:11px;margin:6px 0">
        Quando l'S&amp;P 500 nominale cresce molto più dei profitti aziendali reali, l'eccesso è spiegato da svalutazione monetaria (fiat debasement) e non da crescita degli utili.
        Storicamente gap &gt;40 pp precede correzioni prolungate o lateralizzazione. Vedi 2000, 2007, 2021.
      </div>
      <h4 style="margin:12px 0 4px">S&amp;P 500 nominale vs Profitti Aziendali Reali USA (base 100)</h4>
      ${miniDualChart(cp.sp500, cp.profits, { color1: "var(--blue)", color2: "var(--yellow)", label1: "S&P 500 nominale", label2: "Profitti reali (FRED CP)" })}
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
  const epsForward = r.stats?.eps_forward;
  const epsTTM = r.stats?.eps_ttm ?? r.eps;
  let consensoHtml = "";
  if (r.rating?.key) {
    const rs = RAT_SCORE[r.rating.key] ?? 50;
    const rLab = RAT_LABEL[r.rating.key] ?? r.rating.key;
    consensoHtml = `<h4 style="margin:12px 0 6px">Consenso analisti</h4>
      <div class="info-line"><b>Raccomandazione:</b> <span style="color:${scoreColor(rs)}">${rLab}</span>
        <span class="muted"> · ${r.rating.n ?? "—"} analisti</span></div>
      ${thermoBar(rs, ["Strong Buy", "Strong Sell"])}
      ${r.rating.target ? `<div class="info-line" style="margin-top:6px">
        <b>Target medio:</b> ${cur(r)}${fmtNum.format(r.rating.target)}
        <span class="${signCls(r.rating.upside_pct)}"> (${signTxt(r.rating.upside_pct)} upside)</span></div>` : ""}
      ${epsForward != null ? `<div class="info-line"><b>EPS stimato (forward):</b> ${cur(r)}${fmtNum.format(epsForward)}</div>` : ""}
      ${epsTTM != null ? `<div class="info-line"><b>EPS (TTM):</b> ${cur(r)}${fmtNum.format(epsTTM)}</div>` : ""}`;
  }
  openInfoModal(`${r.name} (${ticker}) — Trimestrale`, `
    <div class="info-line"><b>Data attesa:</b> ${r.earnings_date ? new Date(r.earnings_date).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }) : "n/d"} ${days != null ? `(tra ${days} gg)` : ""}</div>
    ${consensoHtml}
    <div class="info-line muted" style="margin:10px 0 12px">I dati EPS si aggiornano dopo ogni trimestrale riportata. Il target è la media degli analisti coverage (fonte: yfinance).</div>
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
  const rows = sortRows(DATA.portfolio, "ptf-table").map(r => {
    const c = cur(r);
    return `<tr>
      <td class="name-cell">${delBtn("portfolio", r.ticker)}${r.name}<span class="tk">${r.ticker}</span></td>
      <td class="num">${fmtNum.format(r.qty)}</td>
      <td class="num">${c}${fmtNum.format(r.pmc)}</td>
      <td class="num"><b>${priceTxt(r, c)}</b></td>
      <td class="num ${signCls(r.change_pct)}">${signTxt(r.change_pct)}</td>
      <td class="num">${prepostCell(r.prepost)}</td>
      <td class="num">${fmtVolume(r.volume)}</td>
      <td class="num ${signCls(r.gain)}">${signTxt(Math.round(r.gain), ` ${c}`)}${r.currency === "USD" ? `<br><span class="sub-eur">${signTxt(Math.round(r.gain / (DATA.eurusd || 1.08)), " €")}</span>` : ""}</td>
      <td class="num ${signCls(r.gain_pct)}"><b>${signTxt(r.gain_pct)}</b></td>
      ${techCells(r)}
    </tr>`;
  }).join("");

  const t = DATA.totals;
  const usdValue = DATA.portfolio.filter(r => r.currency === "USD").reduce((s, r) => s + r.value, 0);
  const totalRow = `<tr class="total-row">
    <td class="name-cell" colspan="7">TOTALE — ${fmtEUR.format(t.eur_value)} · azioni $${fmtNum.format(Math.round(usdValue))}</td>
    <td class="num ${signCls(t.eur_gain)}">${signTxt(Math.round(t.eur_gain), " €")}</td>
    <td class="num ${signCls(t.eur_gain_pct)}"><b>${signTxt(t.eur_gain_pct)}</b></td>
    <td colspan="12" class="muted" style="font-family:Inter,sans-serif">netto tasse stimato: <b class="${signCls(t.eur_gain_net)}">${signTxt(Math.round(t.eur_gain_net ?? t.eur_gain), " €")}</b></td>
  </tr>`;
  const addRow = editMode.portfolio
    ? `<tr class="add-row"><td colspan="21"><button class="btn btn-ghost btn-sm" id="ptf-add">+ Aggiungi titolo</button></td></tr>` : "";
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
    </tr>`).join("") : '<tr><td colspan="17" class="muted">Nessun dato</td></tr>';
  const addRow = editMode.watchlist
    ? `<tr class="add-row"><td colspan="17"><button class="btn btn-ghost btn-sm" id="wl-add">+ Aggiungi titolo</button></td></tr>` : "";
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
    const fcfWarn = (st.fcf != null && st.net_income_fy != null && st.fcf < st.net_income_fy * 0.6)
      ? ` <span class="warn-flag" title="FCF molto inferiore all'utile: verifica la qualità degli utili">!</span>` : "";
    const roeCls = st.roe == null ? "" : st.roe >= 0.15 ? "text-premium" : st.roe < 0 ? "neg" : "";
    return `<tr class="fund-row" data-fund-tk="${r.ticker}" tabindex="0" role="button" title="${esc(r.name)} — clicca per conto economico e statistiche">${lead}
      <td class="num">${bigUsd(st.market_cap)}</td>
      <td class="num">${st.ev_ebitda != null ? fmtNum.format(st.ev_ebitda) : "—"}</td>
      <td class="num">${colorCell(pctOf(st.roe), roeCls)}</td>
      <td class="num">${pctPlain(st.gross_margin)}</td>
      <td class="num ${st.profit_margin > 0 ? "pos" : st.profit_margin < 0 ? "neg" : ""}">${pctPlain(st.profit_margin)}</td>
      <td class="num">${pfcf != null ? (pfcf < 0 ? `<span class="neg">neg.</span>` : fmtNum.format(pfcf)) + fcfWarn : "—"}</td>
      <td class="num ${st.revenue_growth > 0 ? "pos" : st.revenue_growth < 0 ? "neg" : ""}">${pctOf(st.revenue_growth)}</td>
      <td class="num">${st.dividend_yield ? pctPlain(st.dividend_yield) : "—"}</td>
      <td class="num">${st.price_to_book != null ? fmtNum.format(st.price_to_book) : "—"}</td>
      <td class="num">${st.peg != null ? fmtNum.format(st.peg) : "—"}</td>
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
function renderEarnings() {
  const items = DATA.portfolio
    .filter(r => r.earnings_date)
    .map(r => ({ ...r, days: Math.ceil((new Date(r.earnings_date) - Date.now()) / 86400000) }))
    .sort((a, b) => a.days - b.days);
  $("#earnings-strip").innerHTML = items.length ? items.map(r => {
    const d = new Date(r.earnings_date).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
    const when = r.days <= 0 ? "oggi" : r.days === 1 ? "domani" : `tra ${r.days} gg`;
    // termometro: più vicina = barra più piena e più "calda"
    const pct = Math.max(6, Math.min(100, 100 - r.days * 1.1));
    const color = r.days <= 7 ? "var(--red)" : r.days <= 21 ? "var(--yellow)" : "var(--green)";
    return `<div class="earn-card" data-earn="${r.ticker}" tabindex="0" role="button" title="${esc(r.name)} — clicca per dettagli">
      <div class="earn-top"><span class="earn-tk">${r.ticker}</span><span class="earn-date">${d}</span></div>
      <div class="earn-when" style="color:${color}">${when}</div>
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
    cards.push(thermoCard("carry", "Carry USA–Giappone", score, `${fmtNum.format(cy.spread)} pp`,
      `US10A ${fmtNum.format(cy.us10)}% − JGB ${fmtNum.format(cy.jp10)}%<br>USD/JPY ${fmtNum.format(cy.usdjpy)} (${signTxt(cy.usdjpy_chg_1m)} 1m)`, ["Alto", "Basso"]));
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
    const divTxt = sm.divergence != null
      ? `<br><b style="color:${Math.abs(sm.divergence) > 15 ? "var(--yellow)" : "var(--muted)"}">${sm.divergence_label}</b>`
      : "";
    cards.push(thermoCard("smart_money", "Smart Money vs Retail", sm.score,
      `<b>${sm.label}</b>`,
      `flussi istituzionali (VIX term · HY/IG · P/C)${divTxt}`, ["Difensivo", "Aggressivo"]));
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
    cards.push(thermoCard("corp_profit", "S&P vs Profitti Reali", cp.score,
      `<span style="color:${gapCol}">gap +${cp.gap} pp</span>`,
      `<b style="color:${gapCol}">${cp.label}</b> · S&P nominale vs utili reali`, ["Allineati", "Asset Inflation"]));
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

  // barre ETF settoriali sopra la lista (top 5 per 1M, sintetico)
  const tilt = (DATA.macro || {}).tilt || [];
  let etfBars = "";
  if (tilt.length) {
    const top5 = [...tilt].sort((a, b) => b.m1 - a.m1).slice(0, 5);
    const maxAbs = Math.max(...top5.map(s => Math.abs(s.m1)), 1);
    etfBars = `<div class="m-label" style="margin:14px 0 6px">ETF settoriali — performance 1 mese</div>
      <div class="etf-bars">` + top5.map(s => `
        <div class="etf-bar-row">
          <span class="etf-bar-lab">${esc(s.name)} <span class="tk">${s.ticker}</span></span>
          <span class="etf-bar-track"><span class="etf-bar-fill" style="width:${Math.abs(s.m1) / maxAbs * 100}%;background:${perfColor(s.m1)}"></span></span>
          <span class="etf-bar-val ${signCls(s.m1)}">${signTxt(s.m1)}</span>
        </div>`).join("") + `</div>`;
  }

  $("#topcaps").innerHTML = etfBars +
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
  lines.push("PRIMA di analizzare i dati come un team dei migliori 5 Senior Analyst al mondo, usa la RICERCA WEB per: (a) verificare i prezzi di oggi dei titoli elencati, (b) leggere le ultime notizie/risultati su questi titoli e sul quadro macro-politico, (c) trovare titoli alternativi NON in portafoglio interessanti per diversificare. I dati sotto sono il contesto completo della mia dashboard (portafoglio, watchlist, macro, news, mercati di previsione, rotazione settoriale).");
  lines.push("");
  lines.push("FORNISCI UN REPORT STRUTTURATO (solo a scopo informativo) con:");
  lines.push("1) Sintesi macro e sentiment di mercato (rischio rialzista/ribassista nel breve e nel lungo periodo). Valuta in particolare i segnali di rischio sistemico: spread di credito High Yield, Smart Money vs Retail (divergenze istituzionali), disaccoppiamento S&P/PIL e stato della curva dei rendimenti.");
  lines.push("2) Analisi tecnica titolo per titolo: ipercomprato/ipervenduto (RSI), vicinanza a supporti/resistenze, volumi anomali, trend.");
  lines.push("3) INDICAZIONI OPERATIVE CONCRETE: per ogni titolo indica se mantenere/alleggerire/incrementare, con QUANTE azioni vendere/comprare e a CHE PREZZO (target/limite), stimando la plus/minusvalenza; suggerisci come COMPENSARE le minusvalenze con le plusvalenze (in Italia: azioni 26%, BTP 12,5%; le minus compensano le plus entro 4 anni).");
  lines.push("4) ROTAZIONE & DE-RISKING: il portafoglio è concentrato su TECH/semiconduttori — proponi come ridurre questa intensità usando la liquidità disponibile; indica 2-3 ticker alternativi specifici (value/difensivi) e 2-3 ETF, con prezzi limite d'ingresso, sfruttando la rotazione settoriale qui sotto.");
  lines.push("5) Ottica BREVE periodo (settimane), MEDIO periodo (mesi) e LUNGO periodo (anni), separate, con direzione e tempistiche.");
  lines.push("");
  lines.push(`DATI AL ${new Date(DATA.updated_at).toLocaleString("it-IT")}`);
  lines.push("");
  lines.push(`PORTAFOGLIO (totale ${fmtEUR.format(t.eur_value)}, guadagno lordo ${signTxt(Math.round(t.eur_gain), " €")} / ${signTxt(t.eur_gain_pct)}${t.eur_gain_net !== undefined ? `, netto tasse stimato ${signTxt(Math.round(t.eur_gain_net), " €")}` : ""}):`);
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
  if (m.smart_money) {
    let l = `- Smart Money vs Retail: ${m.smart_money.label} (${m.smart_money.score}/100, da VIX term + HY/IG + put/call)`;
    if (m.smart_money.vix_term_ratio != null) l += `, VIX/VIX3M ${fmtNum.format(m.smart_money.vix_term_ratio)} ${m.smart_money.vix_term_ratio > 1 ? "(backwardation=tensione)" : "(contango=calma)"}`;
    if (m.smart_money.hy_ig_ratio != null) l += `, HY/IG ${fmtNum.format(m.smart_money.hy_ig_ratio)}`;
    if (m.smart_money.divergence != null) l += ` — divergenza col retail: ${m.smart_money.divergence_label}`;
    lines.push(l);
  }
  if (m.decouple?.sp500?.length && m.decouple?.gdp?.length) {
    const gap = Math.round(m.decouple.sp500.slice(-1)[0].v - m.decouple.gdp.slice(-1)[0].v);
    lines.push(`- Disaccoppiamento S&P 500 vs PIL reale: gap ${gap > 0 ? "+" : ""}${gap} pp (>40 pp storicamente precede correzioni; quanta crescita è già prezzata)`);
  }
  if ((m.curve_history || []).length) {
    const cv = m.curve_history.slice(-1)[0].v;
    lines.push(`- Curva 10A-2A: ${cv > 0 ? "+" : ""}${cv} pp (${cv < 0 ? "ancora invertita = rischio recessione" : "tornata positiva dopo l'inversione = dis-inversione in corso"})`);
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
  if (m.corp_profit) lines.push(`- S&P vs Profitti Aziendali Reali (FRED CP): gap ${m.corp_profit.gap > 0 ? "+" : ""}${m.corp_profit.gap} pp — ${m.corp_profit.label} (score ${m.corp_profit.score}/100; gap>40 = Asset Inflation da fiat debasement, non crescita utili reali)`);
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
  document.querySelectorAll(".sell-in").forEach(inp => {
    const r = byTk[inp.dataset.tk];
    const q = Math.min(parseFloat(inp.value) || 0, r.qty);
    const pl = r.plPerShare * q;
    const cell = document.querySelector(`.sell-pl[data-tk="${inp.dataset.tk}"]`);
    cell.textContent = q ? signTxt(Math.round(pl), " €") : "—";
    cell.className = `num sell-pl ${signCls(pl)}`;
    if (q) { if (pl >= 0) gains += pl; else losses += pl; }
    if (r.ticker === "BTP-V28") btpNet += pl; else stockNet += pl;
  });
  // minusvalenze compensano le plusvalenze; tassa solo sul netto positivo
  taxStock = 0.26 * Math.max(0, stockNet);
  taxBtp = 0.125 * Math.max(0, btpNet);
  const net = gains + losses;          // losses è negativo
  const tax = taxStock + taxBtp;
  const afterTax = net - tax;
  // grafico a barre: plus (verde), minus (rosso), netto
  const maxAbs = Math.max(gains, Math.abs(losses), Math.abs(net), 1);
  const bar = (v, col) => `<div class="sb-row"><span class="sb-lab">${v < 0 ? "Minusvalenze" : v === net ? "Netto" : "Plusvalenze"}</span>
    <span class="sb-track"><span class="sb-fill" style="width:${Math.abs(v) / maxAbs * 100}%;background:${col}"></span></span>
    <span class="sb-val ${signCls(v)}">${signTxt(Math.round(v), " €")}</span></div>`;
  $("#sell-summary").innerHTML = `
    <div class="sell-bars">
      ${bar(gains, "var(--green)")}
      ${bar(losses, "var(--red)")}
      ${bar(net, net >= 0 ? "var(--blue)" : "var(--red)")}
    </div>
    <div class="sell-totals">
      <div><span class="muted">Plusvalenze</span> <b class="pos">${signTxt(Math.round(gains), " €")}</b></div>
      <div><span class="muted">Minusvalenze</span> <b class="neg">${signTxt(Math.round(losses), " €")}</b></div>
      <div><span class="muted">Risultato lordo</span> <b class="${signCls(net)}">${signTxt(Math.round(net), " €")}</b></div>
      <div><span class="muted">Tasse stimate (26% az. / 12,5% BTP, al netto delle minus)</span> <b class="neg">−${fmtEUR.format(Math.round(tax))}</b></div>
      <div><span class="muted">Incasso netto stimato</span> <b class="${signCls(afterTax)}">${signTxt(Math.round(afterTax), " €")}</b></div>
    </div>`;
}

/* ---------------- calcolatore PMC ---------------- */
function pmcCompute() {
  const v = (id) => parseFloat($(id).value) || 0;
  const q1 = v("#pmc-q1"), p1 = v("#pmc-p1"), q2 = v("#pmc-q2"), p2 = v("#pmc-p2");
  const qty = q1 + q2, cost = q1 * p1 + q2 * p2;
  if (qty <= 0 || cost <= 0) {
    ["#pmc-new", "#pmc-qty", "#pmc-cost", "#pmc-delta"].forEach(id => { $(id).textContent = "—"; });
    return;
  }
  const pmc = cost / qty;
  $("#pmc-new").textContent = fmtNum.format(Math.round(pmc * 10000) / 10000);
  $("#pmc-qty").textContent = fmtNum.format(qty);
  $("#pmc-cost").textContent = fmtNum.format(Math.round(cost * 100) / 100);
  const el = $("#pmc-delta");
  if (p1 > 0) {
    const d = (pmc / p1 - 1) * 100;
    el.textContent = signTxt(Math.round(d * 100) / 100);
    el.className = signCls(d);
  } else {
    el.textContent = "—"; el.className = "";
  }
}

function pmcInit() {
  const sel = $("#pmc-select");
  const current = sel.value;
  sel.innerHTML = '<option value="">— scegli un titolo o inserisci a mano —</option>' +
    (DATA.portfolio || []).filter(r => r.currency === "USD").map(r =>
      `<option value="${r.ticker}">${esc(r.name)} (${r.ticker})</option>`).join("");
  sel.value = current;   // non perdere la selezione sull'auto-refresh
}

$("#pmc-select").addEventListener("change", () => {
  const r = (DATA?.portfolio || []).find(x => x.ticker === $("#pmc-select").value);
  if (r) {
    $("#pmc-q1").value = r.qty;
    $("#pmc-p1").value = r.pmc;
    $("#pmc-p2").value = r.price;
    $("#pmc-q2").focus();
  }
  pmcCompute();
});
["#pmc-q1", "#pmc-p1", "#pmc-q2", "#pmc-p2"].forEach(id =>
  $(id).addEventListener("input", pmcCompute));

/* liquidità + mini-card */
$("#cash-save").addEventListener("click", saveCash);
$("#cash-input").addEventListener("keydown", e => { if (e.key === "Enter") saveCash(); });
$("#signposts-box").addEventListener("click", openSignpostsModal);
$("#tilt-box").addEventListener("click", openTiltModal);
$("#portfolio-health").addEventListener("click", openHealthModal);
$("#witching-box").addEventListener("click", openWitchingModal);
$("#macroquant-box").addEventListener("click", openMacroQuantModal);
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
  if (sc) { toast(sc.dataset.info); }
});
// accessibilità: Invio/Spazio sulla riga fondamentale aprono il dettaglio
document.addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const fr = e.target.closest && e.target.closest(".fund-row");
  if (fr) { e.preventDefault(); openFinancialsModal(fr.dataset.fundTk); }
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
  const rb = e.target.closest(".cm-range");
  if (rb) { cmRange = rb.dataset.range; drawTickerChart(); }
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
