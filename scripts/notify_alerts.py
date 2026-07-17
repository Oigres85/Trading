#!/usr/bin/env python3
"""NOTIFICHE ALERT (v113) — best-effort, ANTI-FRAGILE: qualunque cosa succeda qui dentro
(token scaduto, rete assente) lo script logga e esce SEMPRE 0 — la pipeline dati non deve
mai fallire per colpa di una notifica.

Cosa notifica (solo VARIAZIONI rispetto all'ultimo alert inviato, dedup via
config/alert_state.json committato dal CI):
  - stop trailing VIOLATI su posizioni (critico: richiede decisione oggi);
  - alert di data quality nuovi (dato macro stale/unreliable);
  - nuovi setup [TURNAROUND SQUEEZE RISK] in watchlist (opportunità speculativa).

Canale UNICO: GitHub Issue sul repo (GITHUB_TOKEN nativo del workflow, zero secret) → GitHub
manda la sua notifica app/email all'owner. WhatsApp/CallMeBot ed email SMTP RIMOSSI per
decisione del CEO (lug 2026 — non reintrodurli).

Lo stato dedup viene aggiornato SOLO se il canale va a buon fine: se fallisce, si ritenta
al run successivo."""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "data.json"
STATE = ROOT / "config" / "alert_state.json"


def collect_alerts(data):
    """Estrae le tre famiglie di alert correnti da data.json (liste ordinate → firma stabile).
    La condizione squeeze DUPLICA volutamente squeezeSetup() di app.js (stessa coppia
    pipeline/JS di validate_macro/validateMacroData): short ≥20% + RVol >2 + sopra SMA50."""
    stops = sorted(r["ticker"] for r in data.get("portfolio", [])
                   if r.get("stop_violated") and r.get("qty"))
    dq = sorted(data.get("data_quality", {}).get("alerts") or [])
    squeeze = sorted(
        r["ticker"] for r in data.get("watchlist", [])
        if ((r.get("stats") or {}).get("short_float") or 0) >= 0.20
        and (r.get("vol_ratio") or 0) > 2.0
        and (r.get("sma50_dist_pct") or 0) > 0
    )
    # MACRO SHOCK ALERT v125: firma = elenco fonti oltre -2% (dedup: se non cambia, niente doppio invio)
    sh = (data.get("macro", {}) or {}).get("shock_alert") or {}
    shock = sorted(f"{s['src']} {s['chg']}%" for s in sh.get("sources", [])) if sh.get("active") else []
    return {"stops": stops, "dq": dq, "squeeze": squeeze, "shock": shock}


def diff_alerts(current, previous):
    """Solo le NOVITÀ (presenti ora, assenti nell'ultimo alert inviato)."""
    prev = previous or {}
    return {k: sorted(set(current.get(k, [])) - set(prev.get(k, []))) for k in current}


def build_message(new, data):
    parts = []
    if new.get("shock"):
        parts.append("🚨 MACRO SHOCK ALERT: " + " · ".join(new["shock"])
                     + " (Asia/futures oltre -2% con Wall Street chiusa) → SOSPENDI acquisti aggressivi, attendi l'assestamento della prima ora USA.")
    if new["stops"]:
        rows = {r["ticker"]: r for r in data.get("portfolio", [])}
        det = []
        for tk in new["stops"]:
            r = rows.get(tk, {})
            det.append(f"{tk} (prezzo ${r.get('price')} sotto stop ${r.get('stop_atr')})")
        parts.append("⛔ STOP VIOLATO: " + " · ".join(det) + " → disciplina: uscita o ri-arm consapevole.")
    if new["squeeze"]:
        parts.append("⚡ TURNAROUND SQUEEZE setup: " + ", ".join(new["squeeze"])
                     + " (short≥20% + volumi anomali + sopra SMA50) — speculativo, sizing dimezzato.")
    if new["dq"]:
        parts.append("🟡 Data quality: " + ", ".join(new["dq"]))
    if not parts:
        return None
    return "Trading Dashboard — alert " + data.get("updated_at", "") + "\n" + "\n".join(parts) \
        + "\nhttps://oigres85.github.io/Trading/"


def send_test():
    """Modalità --test (diagnostica): apre una Issue di prova (bypassa dedup e soglie).
    Utile solo in Actions, dove GITHUB_TOKEN e GITHUB_REPOSITORY sono automatici."""
    msg = ("✅ Trading Dashboard — TEST NOTIFICHE "
           + datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
           + "\nSe vedi questa Issue, il canale di notifica è configurato bene.")
    try:
        ok = bool(send_github_issue(msg))
    except Exception as e:  # noqa: BLE001
        ok = False
        print(f"!! notify --test: {e}", file=sys.stderr)
    if not ok:
        print("!! notify --test: Issue non creata (GITHUB_TOKEN/GITHUB_REPOSITORY presenti "
              "solo in Actions).", file=sys.stderr)
    return ok


def send_github_issue(msg):
    token = os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPOSITORY")
    if not (token and repo):
        return False
    body = json.dumps({"title": "⚠ Alert dashboard — " + msg.splitlines()[0][-25:],
                       "body": msg, "labels": ["alert"]}).encode()
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/issues", data=body, method="POST",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                 "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        ok = r.status in (200, 201)
    print("notify: GitHub Issue", "creata" if ok else f"HTTP {r.status}")
    return ok


def _load_state():
    if STATE.exists():
        try:
            return json.loads(STATE.read_text())
        except Exception:  # noqa: BLE001 — stato corrotto: si riparte da zero
            return {}
    return {}


def send_custom(text):
    """Modalità --custom (v116): messaggio diretto in cascata canali, usata dal RED TEAM
    in CI quando gli invarianti del motore falliscono su dati freschi. Dedup per
    giorno+testo: un workflow rotto che gira ogni ora non deve spammare notifiche."""
    state = _load_state()
    sig = datetime.now(timezone.utc).strftime("%Y-%m-%d") + "|" + text[:120]
    if state.get("last_custom") == sig:
        print("notify: custom già inviato oggi (dedup)")
        return
    msg = "⚠ TRADING DASHBOARD — RED TEAM\n" + text
    try:
        if send_github_issue(msg):
            state["last_custom"] = sig
            STATE.write_text(json.dumps(state, indent=1))
            return
    except Exception as e:  # noqa: BLE001
        print(f"!! notify custom: {e}", file=sys.stderr)
    print("!! notify custom: Issue non creata", file=sys.stderr)


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "--test":
        send_test()
        return
    if len(sys.argv) >= 3 and sys.argv[1] == "--custom":
        send_custom(sys.argv[2])
        return
    data = json.loads(DATA.read_text())
    state = _load_state()
    current = collect_alerts(data)
    new = diff_alerts(current, state.get("last_alerted"))
    msg = build_message(new, data)
    if not msg:
        # niente novità: aggiorna comunque lo stato (gli alert RIENTRATI escono dalla firma,
        # così una futura ricomparsa notifica di nuovo) — nessun invio, nessun file da creare
        STATE.write_text(json.dumps({"last_alerted": current,
                                     "updated": data.get("updated_at")}, indent=1))
        print("notify: nessuna novità")
        return
    sent = False
    try:
        sent = bool(send_github_issue(msg))
    except Exception as e:  # noqa: BLE001
        print(f"!! notify: {e}", file=sys.stderr)
    if sent:
        STATE.write_text(json.dumps({"last_alerted": current,
                                     "updated": data.get("updated_at")}, indent=1))
    else:
        print("!! notify: Issue non creata — si ritenta al prossimo run", file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 — ANTI-FRAGILE: mai bloccare la pipeline
        print(f"!! notify_alerts (best-effort, pipeline NON bloccata): {e}", file=sys.stderr)
    sys.exit(0)
