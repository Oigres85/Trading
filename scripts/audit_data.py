#!/usr/bin/env python3
"""Gate di qualità sul data.json GENERATO (gira in Actions subito dopo la pipeline).
Violazioni HARD (bug di codice, mai legittime) → exit 1 e il commit dei dati si ferma;
anomalie SOFT (dati di mercato mancanti/degradati) → solo warning, i dati passano.
Uso: python3 scripts/audit_data.py [path/data.json]"""
import json
import sys
from pathlib import Path

path = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "data" / "data.json")
d = json.loads(path.read_text())
rows = [r for r in d.get("portfolio", []) if r.get("currency") == "USD"]
wl = d.get("watchlist", [])
hard, soft = [], []

# HARD 1: mai un P/E positivo con EPS TTM negativo (igiene v90)
for r in rows + wl:
    st = r.get("stats") or {}
    eps = r.get("eps") if r.get("eps") is not None else st.get("eps_ttm")
    if eps is not None and eps < 0:
        if r.get("pe"):
            hard.append(f"{r['ticker']}: pe={r['pe']} con EPS {eps}<0")
        if st.get("pe_ttm"):
            hard.append(f"{r['ticker']}: stats.pe_ttm={st['pe_ttm']} con EPS {eps}<0")

# HARD 2: MCR deve sommare ~100% (se presente)
mcr = [r["risk_contrib_pct"] for r in rows if r.get("risk_contrib_pct") is not None]
if mcr and not 90 <= sum(mcr) <= 110:
    hard.append(f"MCR somma {sum(mcr):.1f}% (atteso ~100%)")

# HARD 3: nessun PEG <= 0 nel payload (la pipeline li azzera)
for r in rows + wl:
    peg = (r.get("stats") or {}).get("peg")
    if peg is not None and peg <= 0:
        hard.append(f"{r['ticker']}: peg={peg} <= 0 nel payload")

# HARD 3b: float_pct impossibile (>100%) non deve MAI arrivare nel payload — mislead l'AI
# (multi-classe/ADR con unità Yahoo incompatibili). La pipeline lo nullifica: qui è il gate.
for r in rows + wl:
    fp = (r.get("stats") or {}).get("float_pct")
    if fp is not None and fp > 100:
        hard.append(f"{r['ticker']}: float_pct={fp}% > 100 (impossibile: unità Yahoo incompatibili, va nullificato)")

# HARD 3c: put/call ratio sano (proxy sentiment di mercato, non un singolo titolo illiquido)
pc = (macro_pc := d.get("macro", {}).get("putcall") or {}).get("ratio")
if pc is not None and (pc <= 0 or pc > 5):
    hard.append(f"put/call ratio {pc} fuori range plausibile (0,05–5]: simbolo sbagliato? (era BSX=singolo titolo)")

# HARD 4: stop ratchet coerente (violated ⇔ prezzo < stop)
for r in rows:
    if r.get("stop_atr") is not None and r.get("price"):
        expect = r["price"] < r["stop_atr"]
        if bool(r.get("stop_violated")) != expect:
            hard.append(f"{r['ticker']}: stop_violated={r.get('stop_violated')} incoerente (prezzo {r['price']} vs stop {r['stop_atr']})")

# HARD 5 (post-incidente margin debt): spazzatura macro NON flaggata non deve MAI passare.
# La spazzatura FLAGGATA (data_quality) è un degrado dichiarato → warn, la pipeline vive.
macro = d.get("macro", {})
md = macro.get("margin_debt") or {}
if md and "FINRA" in str(md.get("series", "")) and md.get("value", 0) < 800_000:
    hard.append(f"margin debt 'FINRA' a ${md.get('value'):,}M < $800 mld nel 2026 senza flag: spazzatura non intercettata")
if md and md.get("unreliable") and not any(c.get("key") == "margin_debt" and c.get("status") in ("unreliable", "implausible")
                                           for c in (d.get("data_quality") or {}).get("checks", [])):
    hard.append("margin debt unreliable ma non presente nei check di data_quality")
vix_v = (macro.get("vix") or {}).get("value")
if vix_v is not None and not 5 <= vix_v <= 150:
    hard.append(f"VIX {vix_v} fuori range [5,150] non nullato")
for i in macro.get("indicators", []):
    if i.get("key") in ("cpi", "pce") and str(i.get("value")).strip() in ("0%", "0.0%"):
        hard.append(f"{i['key']} a 0% nel payload: spazzatura non nullata")

# SOFT: alert dichiarati dalla validazione macro (degradi noti, non blocking)
for a in (d.get("data_quality") or {}).get("alerts", []):
    soft.append(f"data_quality: {a}")

# SOFT: campi quant attesi dopo un run completo
t = d.get("totals", {})
for k in ("portfolio_sharpe_ratio", "portfolio_sortino_ratio", "var95_hist_pct", "portfolio_beta_ndx"):
    if t.get(k) is None:
        soft.append(f"totals.{k} n.d.")
n_sortino = sum(1 for r in rows if r.get("sortino_1y") is not None)
if rows and n_sortino < len(rows) * 0.7:
    soft.append(f"sortino_1y presente solo su {n_sortino}/{len(rows)} titoli")

for m in soft:
    print(f"WARN  {m}")
for m in hard:
    print(f"HARD  {m}")
print(f"\naudit: {len(hard)} violazioni hard, {len(soft)} warning su {path.name} ({len(rows)} ptf / {len(wl)} wl)")
sys.exit(1 if hard else 0)
