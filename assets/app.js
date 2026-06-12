/* Trading Dashboard — rendering lato client di data/data.json */
const REPO = "Oigres85/Trading";
let DATA = null;
let sparkRange = "m1";   // 1G | 1M | 1A

const $ = (sel) => document.querySelector(sel);
const fmtEUR = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const fmtUSD = new Intl.NumberFormat("it-IT", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtNum = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function cur(row) { return row.currency === "EUR" ? "€" : "$"; }
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

/* Rigenera TUTTI i dati: lancia il workflow GitHub e attende il nuovo data.json.
   Serve un token GitHub (fine-grained, repo Oigres85/Trading, permesso Actions
   read&write), chiesto una sola volta e salvato solo in questo browser. */
async function refreshAll() {
  const btn = $("#btn-refresh");
  let token = localStorage.getItem("gh_token");
  if (!token) {
    token = window.prompt(
      "Per rigenerare i dati in tempo reale serve un token GitHub del repo " + REPO +
      " (fine-grained, permesso Actions: read & write).\n" +
      "Viene salvato solo in questo browser.\n\n" +
      "Incolla il token, oppure Annulla per ricaricare gli ultimi dati pubblicati:");
    if (token) localStorage.setItem("gh_token", token.trim());
  }
  if (!token) { await loadData(true); return; }

  btn.classList.add("spinning");
  btn.textContent = "⏳ Rigenero…";
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/update-data.yml/dispatches`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token.trim()}`, "Accept": "application/vnd.github+json" },
      body: JSON.stringify({ ref: "main" }),
    });
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      localStorage.removeItem("gh_token");
      toast("Token non valido o senza permessi — rimosso, riprova");
      return;
    }
    if (res.status !== 204) { toast(`Errore nell'avvio dell'aggiornamento (HTTP ${res.status})`); return; }

    toast("Aggiornamento avviato — i nuovi dati arrivano tra ~2-3 minuti");
    const prev = DATA?.updated_at;
    for (let i = 0; i < 24; i++) {          // massimo ~6 minuti
      await new Promise(r => setTimeout(r, 15000));
      try {
        const d = await (await fetch(`data/data.json?t=${Date.now()}`, { cache: "no-store" })).json();
        if (d.updated_at !== prev) {
          DATA = d;
          renderAll();
          toast("Dati rigenerati ✓");
          return;
        }
      } catch { /* tentativo successivo */ }
    }
    toast("L'aggiornamento è ancora in corso — riprova ⟳ tra qualche minuto");
  } catch (e) {
    console.error(e);
    toast("Errore di rete durante l'aggiornamento");
  } finally {
    btn.classList.remove("spinning");
    btn.textContent = "⟳ Aggiorna";
  }
}

function renderAll() {
  const d = new Date(DATA.updated_at);
  $("#updated-at").textContent = d.toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" });
  $("#fx-note").textContent = `EUR/USD ${fmtNum.format(DATA.eurusd)} — azioni in USD, BTP in EUR`;
  renderKPI();
  renderEarnings();
  renderTable();
  renderWatchlist();
  renderGauges();
  renderMacro();
  renderNews();
}

/* ---------------- KPI ---------------- */
function renderKPI() {
  const t = DATA.totals;
  const kpis = [
    { label: "Valore totale (€)", value: fmtEUR.format(t.eur_value), sub: `di cui azioni USA ${fmtUSD.format(t.usd_value)}`, accent: "var(--blue)" },
    { label: "Guadagno totale (€)", value: signTxt(Math.round(t.eur_gain), " €"), sub: `${signTxt(t.eur_gain_pct)} dal carico`, subCls: signCls(t.eur_gain), accent: t.eur_gain >= 0 ? "var(--green)" : "var(--red)", valueCls: signCls(t.eur_gain) },
    { label: "Guadagno azioni USA ($)", value: signTxt(Math.round(t.usd_gain), " $"), sub: `${signTxt(t.usd_gain_pct)} dal carico`, subCls: signCls(t.usd_gain), accent: "var(--purple)", valueCls: signCls(t.usd_gain) },
  ];

  $("#kpi-grid").innerHTML = kpis.map(k => `
    <div class="kpi" style="--accent:${k.accent}">
      <div class="label">${k.label}</div>
      <div class="value ${k.valueCls || ""}">${k.value}</div>
      <div class="sub ${k.subCls || ""}">${k.sub || ""}</div>
    </div>`).join("");
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

function techCells(r) {
  const c = cur(r);
  const pe = (r.pe && r.pe > 0) ? fmtNum.format(r.pe) : "—";
  const ath = r.ath ? `${fmtNum.format(r.ath)} <span class="muted">(${signTxt(r.ath_dist_pct)})</span>` : "—";
  return `
      <td class="num">${pe}</td>
      <td class="num">${ath}</td>
      <td class="num">${r.support ? c + fmtNum.format(r.support) : "—"}</td>
      <td class="num">${r.resistance ? c + fmtNum.format(r.resistance) : "—"}</td>
      <td class="num">${rsiBar(r.rsi)}</td>
      <td class="num">${volBar(r.vol_ratio)}</td>
      <td><span class="badge ${r.signal_class}">${r.signal}</span></td>
      <td>${ratingBadge(r.rating)}</td>
      <td class="num">${targetBar(r.rating)}</td>
      <td>${sparkline((r.sparks || {})[sparkRange])}</td>`;
}

function renderTable() {
  const rows = DATA.portfolio.map(r => {
    const c = cur(r);
    return `<tr>
      <td class="name-cell">${r.name}<span class="tk">${r.ticker}</span></td>
      <td class="num">${fmtNum.format(r.qty)}</td>
      <td class="num">${c}${fmtNum.format(r.pmc)}</td>
      <td class="num"><b>${c}${fmtNum.format(r.price)}</b></td>
      <td class="num ${signCls(r.change_pct)}">${signTxt(r.change_pct)}</td>
      <td class="num">${c}${fmtNum.format(Math.round(r.value))}</td>
      <td class="num ${signCls(r.gain)}">${signTxt(Math.round(r.gain), ` ${c}`)}</td>
      <td class="num ${signCls(r.gain_pct)}"><b>${signTxt(r.gain_pct)}</b></td>
      ${techCells(r)}
    </tr>`;
  }).join("");

  const t = DATA.totals;
  const totalRow = `<tr class="total-row">
    <td class="name-cell">TOTALE (€)</td><td></td><td></td><td></td><td></td>
    <td class="num">${fmtEUR.format(t.eur_value)}</td>
    <td class="num ${signCls(t.eur_gain)}">${signTxt(Math.round(t.eur_gain), " €")}</td>
    <td class="num ${signCls(t.eur_gain_pct)}"><b>${signTxt(t.eur_gain_pct)}</b></td>
    <td colspan="10"></td>
  </tr>`;
  $("#ptf-table tbody").innerHTML = rows + totalRow;
}

function renderWatchlist() {
  const list = DATA.watchlist || [];
  $("#wl-table tbody").innerHTML = list.length ? list.map(r => `<tr>
      <td class="name-cell">${esc(r.name)}<span class="tk">${r.ticker}</span></td>
      <td class="num"><b>$${fmtNum.format(r.price)}</b></td>
      <td class="num ${signCls(r.change_pct)}">${signTxt(r.change_pct)}</td>
      ${techCells(r)}
    </tr>`).join("") : '<tr><td colspan="13" class="muted">Nessun dato</td></tr>';
}

/* ---------------- trimestrali ---------------- */
function renderEarnings() {
  const items = DATA.portfolio
    .filter(r => r.earnings_date)
    .map(r => ({ ...r, days: Math.ceil((new Date(r.earnings_date) - Date.now()) / 86400000) }))
    .sort((a, b) => a.days - b.days);
  $("#earnings-strip").innerHTML = items.length ? "📅 <b>Prossime trimestrali:</b> " + items.map(r => {
    const d = new Date(r.earnings_date).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
    const urgent = r.days <= 7 ? " earn-urgent" : "";
    const when = r.days <= 0 ? "oggi" : r.days === 1 ? "domani" : `tra ${r.days} gg`;
    return `<span class="earn-chip${urgent}" title="${r.name} — ${d}">${r.ticker} ${when} (${d})</span>`;
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

function renderMacro() {
  const markets = (DATA.macro?.markets || []).map(m => `
    <div class="macro-item" style="--accent:${MACRO_ACCENTS[m.key] || "var(--blue)"}">
      <div class="m-label">${m.label}</div>
      <div class="m-value">${m.value}</div>
      <div class="m-sub ${signCls(m.change_pct)}">${signTxt(m.change_pct, m.suffix || "%")} oggi</div>
    </div>`);
  const indicators = (DATA.macro?.indicators || []).map(i => `
    <div class="macro-item" style="--accent:${MACRO_ACCENTS[i.key] || "var(--purple)"}">
      <div class="m-label">${i.label}</div>
      <div class="m-value">${i.value}</div>
      <div class="m-date">${i.date}</div>
    </div>`);
  const cells = markets.concat(indicators);
  $("#macro-grid").innerHTML = cells.length ? cells.join("") : '<span class="muted">Dati non disponibili</span>';
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
      <a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
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
  lines.push(`PORTAFOGLIO (totale ${fmtEUR.format(t.eur_value)}, guadagno ${signTxt(Math.round(t.eur_gain), " €")} / ${signTxt(t.eur_gain_pct)}):`);
  const stockLine = (r) => {
    const c = cur(r);
    let l = `- ${r.name} (${r.ticker}): prezzo ${c}${fmtNum.format(r.price)} | oggi ${signTxt(r.change_pct)}`;
    if (r.qty) l = `- ${r.name} (${r.ticker}): ${fmtNum.format(r.qty)} @ PMC ${c}${fmtNum.format(r.pmc)} | prezzo ${c}${fmtNum.format(r.price)} | oggi ${signTxt(r.change_pct)} | guadagno ${signTxt(r.gain_pct)}`;
    if (r.rsi !== null && r.rsi !== undefined) l += ` | RSI ${r.rsi}`;
    if (r.support) l += ` | supporto ${c}${fmtNum.format(r.support)} / resistenza ${c}${fmtNum.format(r.resistance)}`;
    if (r.pe && r.pe > 0) l += ` | P/E ${fmtNum.format(r.pe)}`;
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
  lines.push("");
  lines.push("ULTIME NEWS SUI TITOLI IN PORTAFOGLIO:");
  (DATA.news || []).slice(0, 14).forEach(n => lines.push(`- [${n.tickers.join(",")}] ${n.title} (${n.source})`));
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
document.querySelectorAll("#spark-toggle .chip").forEach(ch => {
  ch.addEventListener("click", () => {
    document.querySelectorAll("#spark-toggle .chip").forEach(c => c.classList.remove("chip-active"));
    ch.classList.add("chip-active");
    sparkRange = ch.dataset.range;
    renderTable();
    renderWatchlist();
  });
});

loadData();
// auto-refresh ogni 5 minuti
setInterval(() => loadData(), 5 * 60 * 1000);
