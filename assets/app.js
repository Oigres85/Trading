/* Trading Dashboard — rendering lato client di data/data.json */
const REPO = "Oigres85/Trading";
let DATA = null;
let sparkRange = "m1";   // 1G | 1M | 1A

/* ordinamento tabelle: click su intestazione → desc → asc → default */
const SORT_FIELDS = {
  "ptf-table": ["name", "qty", "pmc", "change_pct", "change_pct", "prepost_chg", "volume",
                "gain", "gain_pct", "pe", "eps", "beta", "ath_dist_pct", "support",
                "resistance", "rsi", "vol_ratio", "health", "upside_pct", "upside_pct", null],
  "wl-table": ["name", "change_pct", "change_pct", "prepost_chg", "volume", "pe", "eps",
               "beta", "ath_dist_pct", "support", "resistance", "rsi", "vol_ratio",
               "health", "upside_pct", "upside_pct", null],
};
const sortState = { "ptf-table": { field: null, dir: 0 }, "wl-table": { field: null, dir: 0 } };

function sortVal(r, field) {
  if (field === "prepost_chg") return r.prepost?.change_pct ?? null;
  if (field === "upside_pct") return r.rating?.upside_pct ?? null;
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
function signCls(v) { return v > 0 ? "pos" : v < 0 ? "neg" : ""; }
function signTxt(v, suffix = "%") {
  if (v === null || v === undefined) return "—";
  return (v > 0 ? "+" : "") + fmtNum.format(v) + suffix;
}

async function loadData(showSpin = false) {
  const btn = $("#btn-refresh");
  if (showSpin) btn.classList.add("spinning");
  try {
    const res = await fetch(`data/data.json?t=${Date.now()}`, { cache: "no-store" });
    DATA = await res.json();
    renderAll();
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

/* attende il nuovo data.json (updated_at diverso dal precedente) */
async function waitForNewData(prev, tries = 28) {
  for (let i = 0; i < tries; i++) {
    await new Promise(r => setTimeout(r, 15000));
    try {
      const d = await (await fetch(`data/data.json?t=${Date.now()}`, { cache: "no-store" })).json();
      if (d.updated_at !== prev) { DATA = d; renderAll(); return true; }
    } catch { /* riprova */ }
  }
  return false;
}

async function refreshAll() {
  const btn = $("#btn-refresh");
  const token = getToken();
  if (!token) { await loadData(true); return; }

  btn.classList.add("spinning");
  btn.textContent = "⏳ Rigenero…";
  try {
    const res = await dispatchWorkflow(token);
    if ([401, 403, 404].includes(res.status)) {
      localStorage.removeItem("gh_token");
      toast("Token non valido o senza permessi — rimosso, riprova");
      return;
    }
    if (res.status !== 204) { toast(`Errore nell'avvio dell'aggiornamento (HTTP ${res.status})`); return; }
    toast("Aggiornamento avviato — i nuovi dati arrivano tra ~2-3 minuti");
    if (!await waitForNewData(DATA?.updated_at))
      toast("L'aggiornamento è ancora in corso — riprova ⟳ tra qualche minuto");
    else toast("Dati rigenerati ✓");
  } catch (e) {
    console.error(e);
    toast("Errore di rete durante l'aggiornamento");
  } finally {
    btn.classList.remove("spinning");
    btn.textContent = "⟳ Aggiorna";
  }
}

/* ---------------- aggiungi/rimuovi titoli ---------------- */
const editMode = { portfolio: false, watchlist: false };

async function editHoldings(section, mutate) {
  const token = getToken();
  if (!token) { toast("Serve il token GitHub per modificare le posizioni"); return; }
  toast("Salvo la modifica…");
  try {
    // 1) leggi config/holdings.json con il suo SHA
    const path = "config/holdings.json";
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: ghHeaders(token), cache: "no-store" });
    if (!r.ok) {
      if ([401, 403, 404].includes(r.status)) { localStorage.removeItem("gh_token"); toast("Token non valido/insufficiente — rimosso, riprova"); }
      else toast(`Errore lettura config (HTTP ${r.status})`);
      return;
    }
    const file = await r.json();
    const cfg = JSON.parse(decodeURIComponent(escape(atob(file.content))));
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
    // 3) rigenera i dati
    await dispatchWorkflow(token);
    toast("Posizione aggiornata — rigenero i dati (~2-3 min)…");
    if (await waitForNewData(DATA?.updated_at)) toast("Fatto ✓");
    else toast("Modifica salvata, i dati si aggiornano a breve");
  } catch (e) {
    console.error(e);
    toast("Errore durante la modifica");
  }
}

function addPortfolio() {
  const ticker = (window.prompt("Ticker da aggiungere al portafoglio (es. AAPL):") || "").trim().toUpperCase();
  if (!ticker) return;
  const qty = parseFloat(window.prompt(`Quantità di ${ticker}:`) || "");
  const pmc = parseFloat(window.prompt(`Prezzo medio di carico (PMC) di ${ticker} in USD:`) || "");
  if (!(qty > 0) || !(pmc > 0)) { toast("Quantità/PMC non validi"); return; }
  editHoldings("portfolio", cfg => {
    cfg.portfolio = cfg.portfolio || [];
    if (cfg.portfolio.some(p => p.ticker === ticker)) { toast(`${ticker} è già in portafoglio`); return false; }
    cfg.portfolio.push({ ticker, name: ticker, qty, pmc });
    return true;
  });
}

function addWatchlist() {
  const ticker = (window.prompt("Ticker da aggiungere alla watchlist (es. AAPL, ^GSPC, BTC-USD):") || "").trim().toUpperCase();
  if (!ticker) return;
  editHoldings("watchlist", cfg => {
    cfg.watchlist = cfg.watchlist || [];
    if (cfg.watchlist.some(p => p.ticker === ticker)) { toast(`${ticker} è già in watchlist`); return false; }
    cfg.watchlist.push({ ticker, name: null, currency: ticker.startsWith("^") ? "PTS" : "USD" });
    return true;
  });
}

function removeHolding(section, ticker) {
  if (!window.confirm(`Rimuovere ${ticker} da ${section === "portfolio" ? "portafoglio" : "watchlist"}?`)) return;
  editHoldings(section, cfg => {
    const arr = cfg[section] || [];
    const n = arr.length;
    cfg[section] = arr.filter(p => p.ticker !== ticker);
    return cfg[section].length < n;
  });
}

function renderAll() {
  const d = new Date(DATA.updated_at);
  $("#updated-at").textContent = d.toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" });
  renderKPI();
  renderHistory();
  renderAllocation();
  renderEarnings();
  renderTable();
  renderWatchlist();
  renderGauges();
  renderMacro();
  renderTopCaps();
  renderNews();
  pmcInit();
}

/* ---------------- KPI ---------------- */
function renderKPI() {
  const t = DATA.totals;
  const net = t.eur_gain_net ?? t.eur_gain;
  const kpis = [
    { label: "Guadagno totale lordo (€)", value: signTxt(Math.round(t.eur_gain), " €"),
      sub: `${signTxt(t.eur_gain_pct)} dal carico — valore ${fmtEUR.format(t.eur_value)}`,
      subCls: signCls(t.eur_gain), accent: "var(--blue)", valueCls: signCls(t.eur_gain) },
    { label: "Guadagno netto tasse (€)", value: signTxt(Math.round(net), " €"),
      sub: t.tax_est ? `tasse stimate −${fmtEUR.format(Math.round(t.tax_est))} (26% azioni, 12,5% BTP)` : "",
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
let histRange = "y1";   // m1 | y1 | all

function renderHistory() {
  const h = DATA.history && DATA.history[histRange];
  const box = $("#hist-chart");
  if (!h || h.values.length < 2) { box.innerHTML = '<div class="muted" style="padding:40px 0;text-align:center">Storico non disponibile</div>'; $("#hist-summary").textContent = ""; return; }
  const vals = h.values, dates = h.dates;
  const W = 560, H = 200, pad = { l: 56, r: 12, t: 12, b: 22 };
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const x = i => pad.l + i / (vals.length - 1) * (W - pad.l - pad.r);
  const y = v => pad.t + (1 - (v - min) / range) * (H - pad.t - pad.b);
  const line = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${pad.l},${y(min)} ${line} ${x(vals.length - 1)},${y(min)}`;
  const up = vals[vals.length - 1] >= vals[0];
  const col = up ? "var(--green)" : "var(--red)";
  // griglia 4 livelli
  const grid = [0, .25, .5, .75, 1].map(f => {
    const gv = min + range * f, gy = y(gv);
    return `<line x1="${pad.l}" y1="${gy.toFixed(1)}" x2="${W - pad.r}" y2="${gy.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>
      <text x="${pad.l - 6}" y="${(gy + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)">${fmtNum.format(Math.round(gv / 1000))}k</text>`;
  }).join("");
  // etichette x: prima, metà, ultima
  const xl = [0, Math.floor(vals.length / 2), vals.length - 1].map(i => {
    const dt = new Date(dates[i]).toLocaleDateString("it-IT", { month: "short", year: "2-digit" });
    return `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--muted)">${dt}</text>`;
  }).join("");
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:200px">
    <defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${col}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <polygon points="${area}" fill="url(#hg)"/>
    <polyline points="${line}" fill="none" stroke="${col}" stroke-width="2"/>
    ${xl}
  </svg>`;
  const first = vals[0], last = vals[vals.length - 1];
  const chg = (last / first - 1) * 100;
  $("#hist-summary").innerHTML = `${fmtEUR.format(first)} → <b>${fmtEUR.format(last)}</b>
    <span class="${signCls(chg)}">${signTxt(Math.round(chg * 100) / 100)}</span>
    nel periodo · min ${fmtEUR.format(min)} · max ${fmtEUR.format(max)}`;
}

/* ---------------- asset allocation (donut) ---------------- */
const ALLOC_COLORS = ["#4c8dff", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444", "#22d3ee",
  "#ec4899", "#14b8a6", "#a3a3a3", "#eab308", "#6366f1"];

function renderAllocation() {
  const list = DATA.allocation || [];
  if (!list.length) { $("#alloc-donut").innerHTML = ""; $("#alloc-legend").innerHTML = ""; return; }
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
    return `<path d="${d}" fill="${ALLOC_COLORS[i % ALLOC_COLORS.length]}"><title>${esc(x.name)}: ${fmtEUR.format(x.value_eur)} (${(frac * 100).toFixed(1)}%)</title></path>`;
  }).join("");
  $("#alloc-donut").innerHTML = `<svg viewBox="0 0 160 160" width="160" height="160">
    ${arcs}
    <text x="80" y="76" text-anchor="middle" font-size="11" fill="var(--muted)">Totale</text>
    <text x="80" y="92" text-anchor="middle" font-size="13" font-weight="700" fill="var(--text)">${fmtEUR.format(Math.round(total))}</text>
  </svg>`;
  $("#alloc-legend").innerHTML = list.map((x, i) => {
    const pct = (x.value_eur / total * 100).toFixed(1);
    return `<li class="alloc-item">
      <span class="alloc-dot" style="background:${ALLOC_COLORS[i % ALLOC_COLORS.length]}"></span>
      <span class="alloc-name">${esc(x.name)} <span class="tk">${x.ticker}</span></span>
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
  // verde nella zona neutrale, giallo verso 30/70, rosso agli estremi
  const dist = Math.abs(rsi - 50);
  const color = dist <= 10 ? "var(--green)" : dist <= 20 ? "var(--yellow)" : "var(--red)";
  return meterBar(rsi, color, fmtNum.format(rsi));
}

function volBar(ratio) {
  if (!ratio) return "—";
  // volume vs media 30gg: verde = normale, rosso = anomalo
  const color = ratio < 1.2 ? "var(--green)" : ratio < 2 ? "var(--yellow)" : "var(--red)";
  return meterBar((ratio / 3) * 100, color, `${fmtNum.format(ratio)}×`);
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
  const u = r.upside_pct;
  const color = u >= 15 ? "var(--green)" : u >= 0 ? "var(--yellow)" : "var(--red)";
  return meterBar(Math.abs(u) * 2, color, signTxt(u));
}

function peBar(pe) {
  if (!pe || pe <= 0) return "—";
  const color = pe <= 18 ? "var(--green)" : pe <= 35 ? "var(--yellow)" : "var(--red)";
  return meterBar(Math.min(pe, 60) / 60 * 100, color, fmtNum.format(pe));
}

function epsBar(eps) {
  if (eps === null || eps === undefined) return "—";
  const color = eps > 0 ? "var(--green)" : "var(--red)";
  return meterBar(Math.min(Math.abs(eps), 15) / 15 * 100, color, fmtNum.format(eps));
}

function betaBar(beta) {
  if (beta === null || beta === undefined) return "—";
  const color = beta <= 1 ? "var(--green)" : beta <= 1.6 ? "var(--yellow)" : "var(--red)";
  return meterBar(Math.min(beta, 3) / 3 * 100, color, fmtNum.format(beta));
}

function athBar(r) {
  if (!r.ath) return "—";
  const closeness = Math.max(0, 100 + r.ath_dist_pct);   // 100 = sul massimo storico
  const color = closeness >= 90 ? "var(--green)" : closeness >= 70 ? "var(--yellow)" : "var(--red)";
  return `<div class="meter" title="Max storico ${fmtNum.format(r.ath)}">
    <span class="meter-txt">${signTxt(r.ath_dist_pct)}</span>
    <span class="meter-track"><span class="meter-fill" style="width:${Math.max(3, closeness)}%;background:${color}"></span></span>
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

function techCells(r) {
  const c = cur(r);
  return `
      <td class="num">${peBar(r.pe)}</td>
      <td class="num">${epsBar(r.eps)}</td>
      <td class="num">${betaBar(r.beta)}</td>
      <td class="num">${athBar(r)}</td>
      <td class="num">${r.support ? c + fmtNum.format(r.support) : "—"}</td>
      <td class="num">${r.resistance ? c + fmtNum.format(r.resistance) : "—"}</td>
      <td class="num">${rsiBar(r.rsi)}</td>
      <td class="num">${volBar(r.vol_ratio)}</td>
      <td><span class="badge ${r.signal_class}">${r.signal}</span></td>
      <td>${ratingBadge(r.rating)}</td>
      <td class="num">${targetBar(r.rating)}</td>
      <td>${sparkline((r.sparks || {})[sparkRange])}</td>`;
}

function delBtn(section, ticker) {
  return editMode[section] && ticker !== "BTP-V28"
    ? `<button class="row-del" data-sec="${section}" data-tk="${ticker}" title="Rimuovi ${ticker}">×</button>` : "";
}

function renderTable() {
  const rows = sortRows(DATA.portfolio, "ptf-table").map(r => {
    const c = cur(r);
    return `<tr>
      <td class="name-cell">${delBtn("portfolio", r.ticker)}${r.name}<span class="tk">${r.ticker}</span></td>
      <td class="num">${fmtNum.format(r.qty)}</td>
      <td class="num">${c}${fmtNum.format(r.pmc)}</td>
      <td class="num"><b>${c}${fmtNum.format(r.price)}</b></td>
      <td class="num ${signCls(r.change_pct)}">${signTxt(r.change_pct)}</td>
      <td class="num">${prepostCell(r.prepost)}</td>
      <td class="num">${fmtVolume(r.volume)}</td>
      <td class="num ${signCls(r.gain)}" title="valore posizione ${c}${fmtNum.format(Math.round(r.value))}">${signTxt(Math.round(r.gain), ` ${c}`)}</td>
      <td class="num ${signCls(r.gain_pct)}"><b>${signTxt(r.gain_pct)}</b></td>
      ${techCells(r)}
    </tr>`;
  }).join("");

  const t = DATA.totals;
  const totalRow = `<tr class="total-row">
    <td class="name-cell" colspan="7">TOTALE — valore ${fmtEUR.format(t.eur_value)}</td>
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
      <td class="name-cell">${delBtn("watchlist", r.ticker)}${esc(r.name)}<span class="tk">${r.ticker}</span></td>
      <td class="num"><b>${c(r)}${fmtNum.format(r.price)}</b></td>
      <td class="num ${signCls(r.change_pct)}">${signTxt(r.change_pct)}</td>
      <td class="num">${prepostCell(r.prepost)}</td>
      <td class="num">${fmtVolume(r.volume)}</td>
      ${techCells(r)}
    </tr>`).join("") : '<tr><td colspan="17" class="muted">Nessun dato</td></tr>';
  const addRow = editMode.watchlist
    ? `<tr class="add-row"><td colspan="17"><button class="btn btn-ghost btn-sm" id="wl-add">+ Aggiungi titolo</button></td></tr>` : "";
  $("#wl-table tbody").innerHTML = rows + addRow;
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
    return `<div class="earn-card" title="${esc(r.name)} — trimestrale il ${d}">
      <div class="earn-top"><span class="earn-tk">${r.ticker}</span><span class="earn-when">${when}</span></div>
      <div class="earn-date">${d}</div>
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

function renderGauges() {
  const m = DATA.macro || {};
  const cards = [];

  if (m.fear_greed) {
    const fg = m.fear_greed;
    cards.push(`<div class="gauge-card">
      <div class="g-title">Fear &amp; Greed</div>
      ${gaugeSVG(fg.score, fgColor(fg.score))}
      <div class="gauge-value">${fg.score}</div>
      <div class="gauge-sub"><b>${FG_LABELS[fg.rating] || fg.rating}</b><br>
      1 sett. fa: ${fg.week_ago} · 1 mese fa: ${fg.month_ago}</div>
    </div>`);
  }

  if (m.vix) {
    const vixPct = Math.min(100, (m.vix.value / 50) * 100);
    const vixColor = m.vix.value < 17 ? "var(--green)" : m.vix.value < 25 ? "var(--yellow)" : "var(--red)";
    cards.push(`<div class="gauge-card">
      <div class="g-title">VIX — Volatilità</div>
      ${gaugeSVG(vixPct, vixColor)}
      <div class="gauge-value">${fmtNum.format(m.vix.value)}</div>
      <div class="gauge-sub">${signTxt(m.vix.change_pct)} oggi<br>
      ${m.vix.value < 17 ? "Mercato calmo" : m.vix.value < 25 ? "Tensione moderata" : "Alta volatilità"}</div>
    </div>`);
  }

  if (m.fedwatch) {
    const fw = m.fedwatch;
    const dir = fw.delta_bp <= -10 ? `tagli prezzati (~${Math.abs(fw.delta_bp)} bp)` :
                fw.delta_bp >= 10 ? `rialzi prezzati (~${fw.delta_bp} bp)` : "tassi fermi attesi";
    cards.push(`<div class="gauge-card">
      <div class="g-title">FedWatch (futures FF)</div>
      <div style="padding:14px 0 6px"><div class="gauge-value">${fw.target_range}</div></div>
      <div class="gauge-sub">Range obiettivo Fed attuale<br>
      Tasso implicito: <b>${fmtNum.format(fw.implied_rate)}%</b><br>${dir}</div>
    </div>`);
  }

  if (m.carry) {
    const cy = m.carry;
    // spread 0–5% mappato 0–100: più ampio = carry più favorevole
    const pct = Math.max(0, Math.min(100, cy.spread / 5 * 100));
    const color = cy.spread >= 3 ? "var(--green)" : cy.spread >= 1.5 ? "var(--yellow)" : "var(--red)";
    cards.push(`<div class="gauge-card">
      <div class="g-title">Carry USA–Giappone</div>
      ${gaugeSVG(pct, color)}
      <div class="gauge-value">${fmtNum.format(cy.spread)} pp</div>
      <div class="gauge-sub">US10A ${fmtNum.format(cy.us10)}% − JGB10A ${fmtNum.format(cy.jp10)}%<br>
      USD/JPY ${fmtNum.format(cy.usdjpy)} (${signTxt(cy.usdjpy_chg_1m)} 1 mese)</div>
    </div>`);
  }

  if (m.putcall) {
    const pc = m.putcall;
    // ratio 0–2 mappato 0–100: alto = prevalgono put
    const pct = Math.max(0, Math.min(100, pc.ratio / 2 * 100));
    const color = pc.ratio <= 0.8 ? "var(--green)" : pc.ratio <= 1.1 ? "var(--yellow)" : "var(--red)";
    cards.push(`<div class="gauge-card">
      <div class="g-title">Put/Call ${pc.symbol}</div>
      ${gaugeSVG(pct, color)}
      <div class="gauge-value">${fmtNum.format(pc.ratio)}</div>
      <div class="gauge-sub"><b>${pc.ratio > 1 ? "Prevalgono PUT" : "Prevalgono CALL"}</b> (${esc(pc.name)})<br>
      put ${pc.puts.toLocaleString("it-IT")} · call ${pc.calls.toLocaleString("it-IT")}</div>
    </div>`);
  }

  if (m.risk_sentiment) {
    const rs = m.risk_sentiment;
    const color = rs.score >= 60 ? "var(--green)" : rs.score <= 40 ? "var(--red)" : "var(--yellow)";
    const detail = (rs.components || []).map(cp => `${esc(cp.label)} ${cp.score}`).join(" · ");
    cards.unshift(`<div class="gauge-card">
      <div class="g-title">Sentiment globale</div>
      ${gaugeSVG(rs.score, color)}
      <div class="gauge-value">${rs.score}</div>
      <div class="gauge-sub"><b>${rs.label}</b><br><span title="${detail}">composito F&amp;G · VIX · P/C · BTC · 10A</span></div>
    </div>`);
  }

  if (m.thermometer) {
    const th = m.thermometer;
    const color = th.score >= 60 ? "var(--green)" : th.score <= 40 ? "var(--red)" : "var(--yellow)";
    cards.push(`<div class="gauge-card">
      <div class="g-title">Termometro portafoglio</div>
      ${gaugeSVG(th.score, color)}
      <div class="gauge-value">${th.score}</div>
      <div class="gauge-sub"><b>${th.label}</b><br>media RSI + trend + momentum dei titoli</div>
    </div>`);
  }

  $("#gauges").innerHTML = cards.join("") || '<span class="muted">Dati non disponibili</span>';
}

/* ---------------- macro ---------------- */
const MACRO_ACCENTS = { cpi: "var(--red)", pce: "var(--yellow)", gdp: "var(--blue)", retail: "var(--purple)", nfp: "var(--green)", unemp: "var(--cyan)", pmi: "var(--blue)", "BTC-USD": "var(--yellow)", "CL=F": "var(--purple)", "^KS11": "var(--cyan)", "^IXIC": "var(--blue)" };

function impactBar(score, titleTxt) {
  if (score === null || score === undefined) return "";
  const color = score >= 60 ? "var(--green)" : score >= 40 ? "var(--yellow)" : "var(--red)";
  return `<div class="impact" title="${titleTxt || "impatto sul mercato"}: ${score}/100">
    <span class="impact-fill" style="width:${Math.max(4, score)}%;background:${color}"></span>
  </div>`;
}

function marketImpact(m) {
  // variazione giornaliera → impatto 0-100 (rendimenti in pp: salita = restrittivo)
  if (m.change_pct === null || m.change_pct === undefined) return null;
  if (m.suffix === " pp") return Math.round(Math.max(0, Math.min(100, 50 - m.change_pct * 300)));
  return Math.round(Math.max(0, Math.min(100, 50 + m.change_pct * 12)));
}

function renderMacro() {
  const markets = (DATA.macro?.markets || []).map(m => `
    <div class="macro-item" style="--accent:${MACRO_ACCENTS[m.key] || "var(--blue)"}">
      <div class="m-label">${m.label}</div>
      <div class="m-value">${m.value}</div>
      <div class="m-sub ${signCls(m.change_pct)}">${signTxt(m.change_pct, m.suffix || "%")} oggi</div>
      ${impactBar(marketImpact(m), "impatto della variazione odierna")}
    </div>`);
  const indicators = (DATA.macro?.indicators || []).map(i => `
    <div class="macro-item" style="--accent:${MACRO_ACCENTS[i.key] || "var(--purple)"}">
      <div class="m-label">${i.label}</div>
      <div class="m-value">${i.value}</div>
      <div class="m-date">${i.date}</div>
      ${impactBar(i.impact, "impatto sul mercato")}
    </div>`);
  const cells = markets.concat(indicators);
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
  $("#topcaps").innerHTML = `<div class="m-label" style="margin:14px 0 8px">🏆 Top 10 capitalizzazioni mondiali</div>
    <ol class="topcap-list">` + list.map((x, i) => `
      <li class="topcap-item">
        <span class="topcap-rank">${i + 1}</span>
        <span class="topcap-name">${esc(x.name)} <span class="tk">${x.ticker}</span></span>
        <span class="topcap-mcap">${fmtMcap(x.mcap_usd)}</span>
        <span class="topcap-chg ${signCls(x.change_pct)}">${x.change_pct >= 0 ? "▲" : "▼"} ${signTxt(x.change_pct)}</span>
      </li>`).join("") + "</ol>";
}

/* ---------------- news ---------------- */
function timeAgo(iso) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${mins} min fa`;
  if (mins < 1440) return `${Math.round(mins / 60)} h fa`;
  return `${Math.round(mins / 1440)} gg fa`;
}

function renderNews() {
  const list = DATA.news || [];
  $("#news-list").innerHTML = list.length ? list.map(n => `
    <li class="news-item">
      <a href="${esc(n.link)}" target="_blank" rel="noopener" title="${esc(n.title)}">${esc(n.title_it || n.title)}</a>
      <div class="news-meta">
        <span class="news-src">${esc(n.source)}</span>
        <span class="news-time">${timeAgo(n.published)}</span>
        ${n.tickers.map(t => `<span class="news-tk">${t}</span>`).join("")}
      </div>
    </li>`).join("") : '<li class="muted">Nessuna news recente sui titoli in portafoglio</li>';
}

/* ---------------- prompt AI ---------------- */
function buildPrompt() {
  const t = DATA.totals;
  const m = DATA.macro || {};
  const lines = [];
  lines.push("Sei un analista finanziario esperto. Analizza il mio portafoglio con i dati di mercato qui sotto e fornisci: 1) valutazione sintetica della situazione, 2) titoli a rischio o con segnali tecnici rilevanti (RSI, supporti/resistenze), 3) impatto del quadro macro, 4) eventuali azioni da considerare (non è una richiesta di consulenza, voglio un'analisi ragionata).");
  lines.push("");
  lines.push(`DATI AL ${new Date(DATA.updated_at).toLocaleString("it-IT")}`);
  lines.push("");
  lines.push(`PORTAFOGLIO (totale ${fmtEUR.format(t.eur_value)}, guadagno lordo ${signTxt(Math.round(t.eur_gain), " €")} / ${signTxt(t.eur_gain_pct)}${t.eur_gain_net !== undefined ? `, netto tasse stimato ${signTxt(Math.round(t.eur_gain_net), " €")}` : ""}):`);
  const stockLine = (r) => {
    const c = cur(r);
    let l = `- ${r.name} (${r.ticker}): prezzo ${c}${fmtNum.format(r.price)} | oggi ${signTxt(r.change_pct)}`;
    if (r.qty) l = `- ${r.name} (${r.ticker}): ${fmtNum.format(r.qty)} @ PMC ${c}${fmtNum.format(r.pmc)} | prezzo ${c}${fmtNum.format(r.price)} | oggi ${signTxt(r.change_pct)} | guadagno ${signTxt(r.gain_pct)}`;
    if (r.rsi !== null && r.rsi !== undefined) l += ` | RSI ${r.rsi}`;
    if (r.support) l += ` | supporto ${c}${fmtNum.format(r.support)} / resistenza ${c}${fmtNum.format(r.resistance)}`;
    if (r.pe && r.pe > 0) l += ` | P/E ${fmtNum.format(r.pe)}`;
    if (r.eps !== null && r.eps !== undefined) l += ` | EPS ${fmtNum.format(r.eps)}`;
    if (r.beta !== null && r.beta !== undefined) l += ` | beta ${fmtNum.format(r.beta)}`;
    if (r.prepost?.price) l += ` | ${r.prepost.label}-market ${c}${fmtNum.format(r.prepost.price)} (${signTxt(r.prepost.change_pct)})`;
    if (r.rating?.key) l += ` | rating analisti: ${r.rating.key} (target ${c}${fmtNum.format(r.rating.target)}, ${signTxt(r.rating.upside_pct)} dal prezzo)`;
    if (r.earnings_date) l += ` | prossima trimestrale: ${r.earnings_date}`;
    l += ` | segnale: ${r.signal}`;
    return l;
  };
  DATA.portfolio.forEach(r => lines.push(stockLine(r)));
  if ((DATA.watchlist || []).length) {
    lines.push("");
    lines.push("WATCHLIST (nessuna posizione):");
    DATA.watchlist.forEach(r => lines.push(stockLine(r)));
  }
  lines.push("");
  lines.push("QUADRO MACRO:");
  if (m.risk_sentiment) lines.push(`- Sentiment globale: ${m.risk_sentiment.label} (${m.risk_sentiment.score}/100)`);
  if (m.thermometer) lines.push(`- Termometro tecnico del portafoglio: ${m.thermometer.label} (${m.thermometer.score}/100)`);
  if (m.fear_greed) lines.push(`- Fear & Greed: ${m.fear_greed.score} (${FG_LABELS[m.fear_greed.rating] || m.fear_greed.rating}), 1 settimana fa ${m.fear_greed.week_ago}, 1 mese fa ${m.fear_greed.month_ago}`);
  if (m.vix) lines.push(`- VIX: ${m.vix.value} (${signTxt(m.vix.change_pct)} oggi)`);
  if (m.fedwatch) lines.push(`- Fed: range ${m.fedwatch.target_range}, tasso implicito futures ${m.fedwatch.implied_rate}%`);
  if (m.carry) lines.push(`- Carry USA-Giappone: spread ${fmtNum.format(m.carry.spread)} pp (US10A ${m.carry.us10}%, JGB10A ${m.carry.jp10}%), USD/JPY ${m.carry.usdjpy} (${signTxt(m.carry.usdjpy_chg_1m)} 1 mese)`);
  if (m.putcall) lines.push(`- Put/Call ${m.putcall.symbol} (${m.putcall.name}): ${m.putcall.ratio} (put ${m.putcall.puts}, call ${m.putcall.calls})`);
  (m.markets || []).forEach(x => lines.push(`- ${x.label}: ${x.value} (${signTxt(x.change_pct, x.suffix || "%")} oggi)`));
  (m.indicators || []).forEach(i => lines.push(`- ${i.label}: ${i.value} (${i.date})`));
  if ((DATA.top_caps || []).length) {
    lines.push("");
    lines.push("TOP 10 CAPITALIZZAZIONI MONDIALI:");
    DATA.top_caps.forEach((x, i) => lines.push(`${i + 1}. ${x.name} (${x.ticker}): ${fmtMcap(x.mcap_usd)} (${signTxt(x.change_pct)} oggi)`));
  }
  lines.push("");
  lines.push("ULTIME NEWS (portafoglio + macro/politica USA):");
  (DATA.news || []).slice(0, 16).forEach(n => lines.push(`- [${n.tickers.join(",")}] ${n.title} (${n.source})`));
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

document.querySelectorAll("#spark-toggle .chip").forEach(ch => {
  ch.addEventListener("click", () => {
    document.querySelectorAll("#spark-toggle .chip").forEach(c => c.classList.remove("chip-active"));
    ch.classList.add("chip-active");
    sparkRange = ch.dataset.range;
    renderTable();
    renderWatchlist();
  });
});
document.querySelectorAll("#hist-toggle .chip").forEach(ch => {
  ch.addEventListener("click", () => {
    document.querySelectorAll("#hist-toggle .chip").forEach(c => c.classList.remove("chip-active"));
    ch.classList.add("chip-active");
    histRange = ch.dataset.range;
    renderHistory();
  });
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
  if (e.target.id === "ptf-add") addPortfolio();
  if (e.target.id === "wl-add") addWatchlist();
});

initSorting("ptf-table", renderTable);
initSorting("wl-table", renderWatchlist);

loadData();
// auto-refresh ogni 5 minuti
setInterval(() => loadData(), 5 * 60 * 1000);
