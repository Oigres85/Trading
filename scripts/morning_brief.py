#!/usr/bin/env python3
"""MORNING BRIEF WhatsApp (v117) — digest DETERMINISTICO delle 09:00, zero LLM.
Risponde a una sola domanda: "c'è qualcosa oggi per cui vale la pena aprire il flusso
completo (dashboard → Copia prompt AI → advisory)?". Tutti i numeri vengono da
data.json già blindato dagli invarianti (audit + red team): niente allucinazioni
possibili, niente giudizio — quello resta al report advisory chiesto a mano.

Contenuto: controvalore e variazione · verdetto motore + candidati (dall'ultimo run
del registro verdetti) · distanza dagli stop ratchet + eventuali violazioni · earnings
imminenti sulle posizioni · alert data quality · VIX e term structure con delta 7g ·
stato track record.

Anti-fragile come notify_alerts: exit 0 SEMPRE. Doppio cron CET/CEST nel workflow →
la guardia oraria (Europe/Rome == 9) o la presenza di emergenze intraday
evita il doppio invio di routine; workflow_dispatch o FORCE_BRIEF=1 bypassano sempre."""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from notify_alerts import send_whatsapp  # noqa: E402 — stesso canale già configurato

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "data.json"
VERDICTS = ROOT / "config" / "verdict_history.jsonl"


def _last_verdict():
    try:
        lines = [ln for ln in VERDICTS.read_text().splitlines() if ln.strip()]
        return json.loads(lines[-1]) if lines else None
    except Exception:  # noqa: BLE001
        return None


def _fmt(v, dec=0):
    if v is None:
        return "n.d."
    s = f"{v:,.{dec}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return s


def build_brief(data, verdict, now=None):
    """Compone il messaggio (puro: testabile). ≤ ~1400 caratteri per stare comodi
    nell'URL GET di CallMeBot."""
    now = now or datetime.now(timezone.utc)
    t = data.get("totals") or {}
    rows = [r for r in data.get("portfolio", []) if r.get("currency") == "USD"]
    out = []
    out.append(f"MORNING BRIEF {now.strftime('%d/%m')} · dati {str(data.get('updated_at', ''))[11:16]} UTC")

    # patrimonio investito (MTM) + variazione di giornata pesata sui controvalori
    day = None
    wsum = sum(r.get("value") or 0 for r in rows if r.get("change_pct") is not None)
    if wsum > 0:
        day = sum((r.get("value") or 0) * (r.get("change_pct") or 0) for r in rows
                  if r.get("change_pct") is not None) / wsum
    out.append(f"Investito: EUR {_fmt(t.get('eur_value'))} ({'+' if (t.get('eur_gain_pct') or 0) >= 0 else ''}{_fmt(t.get('eur_gain_pct'), 1)}%)"
               + (f" · ultima seduta {'+' if day >= 0 else ''}{_fmt(day, 1)}%" if day is not None else ""))

    # verdetto motore + candidati (ultimo run loggato)
    if verdict:
        cands = " · ".join(f"{c['tk']} {c.get('q', '?')}/100 lim ${_fmt(c.get('limit'), 2)}"
                           for c in (verdict.get("candidates") or [])[:3])
        out.append(f"Motore: {verdict.get('label', 'n.d.')}" + (f" — {cands}" if cands else ""))
        if verdict.get("rehab"):
            out.append("Riabilitati (sorvegliati): " + ", ".join(verdict["rehab"]))
        if verdict.get("squeeze"):
            out.append("Squeeze speculativi: " + ", ".join(verdict["squeeze"]))

    # stop: violazioni prima di tutto, poi i 3 più vicini
    viol = [r["ticker"] for r in rows if r.get("stop_violated")]
    if viol:
        out.append("STOP VIOLATO: " + ", ".join(viol) + " — uscita o ri-arm consapevole")
    dist = sorted(((r["ticker"], (r["price"] / r["stop_atr"] - 1) * 100)
                   for r in rows if r.get("stop_atr") and r.get("price") and not r.get("stop_violated")),
                  key=lambda x: x[1])[:3]
    if dist:
        out.append("Stop vicini: " + " · ".join(f"{tk} +{_fmt(d, 1)}%" for tk, d in dist))

    # earnings ≤7g sulle posizioni
    today = now.date()
    earn = []
    for r in rows:
        ed = r.get("earnings_date")
        if ed:
            try:
                dd = (datetime.fromisoformat(ed).date() - today).days
                if 0 <= dd <= 7:
                    earn.append(f"{r['ticker']} {ed[8:10]}/{ed[5:7]}")
            except Exception:  # noqa: BLE001
                pass
    if earn:
        out.append("Earnings <=7g: " + " · ".join(earn))

    # alert data quality (già dichiarati dalla pipeline)
    alerts = (data.get("data_quality") or {}).get("alerts") or []
    if alerts:
        out.append("Data quality: " + ", ".join(alerts))

    # VIX + term structure con delta 7 giorni (dalla cinematica)
    hist = data.get("metrics_history") or []
    vixv = (data.get("macro", {}).get("vix") or {}).get("value")
    if vixv is not None:
        line = f"VIX {_fmt(vixv, 1)}"
        old = next((p for p in reversed(hist)
                    if p.get("vix") is not None and (now.date() - datetime.fromisoformat(p["date"]).date()).days >= 6), None)
        if old:
            d7 = vixv - old["vix"]
            line += f" ({'+' if d7 >= 0 else ''}{_fmt(d7, 1)} vs 7g)"
        vt = (data.get("macro", {}).get("smart_money") or {}).get("vix_term_ratio")
        if vt is not None:
            line += f" · term {_fmt(vt, 2)} ({'backwardation: stress' if vt >= 1 else 'contango: calma'})"
        out.append(line)

    # track record del motore
    vt_ = data.get("verdict_track") or {}
    n30 = (vt_.get("n30") or {})
    if n30.get("count"):
        out.append(f"Track record 30g: {n30['count']} segnali, media {'+' if n30.get('avg_ret', 0) >= 0 else ''}{_fmt(n30.get('avg_ret'), 1)}% (NDX {'+' if n30.get('avg_ndx', 0) >= 0 else ''}{_fmt(n30.get('avg_ndx'), 1)}%), hit {_fmt(n30.get('hit_rate'))}%")
    else:
        out.append("Track record: in costruzione")

    out.append("Se operi oggi: dashboard > Copia prompt AI")
    msg = "\n".join(out)
    return msg[:1400]


def main():
    forced = os.environ.get("FORCE_BRIEF") == "1" or os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
    hour_rome = datetime.now(ZoneInfo("Europe/Rome")).hour
    
    data = json.loads(DATA.read_text())
    verdict = _last_verdict()
    
    # Valutazione emergenze per bypass veto orario (Event-Driven)
    rows = [r for r in data.get("portfolio", []) if r.get("currency") == "USD"]
    stop_violati = any(r.get("stop_violated") for r in rows)
    alerts = (data.get("data_quality") or {}).get("alerts") or []
    has_critical_alerts = any("MACRO SHOCK" in str(a).upper() or "SHOCK" in str(a).upper() for a in alerts)
    has_squeeze = bool(verdict and verdict.get("squeeze"))
    
    is_emergency = stop_violati or has_critical_alerts or has_squeeze
    
    # Veto: esegui solo se è il run delle 9:00, se forzato, o se c'è un'emergenza da segnalare
    if not (forced or hour_rome == 9 or is_emergency):
        print(f"brief: ora locale {hour_rome} ≠ 9 e nessuna emergenza rilevata — skip")
        return

    msg = build_brief(data, verdict)
    
    # Se è un bypass di emergenza fuori orario, aggiungi una riga di allarme in cima
    if is_emergency and hour_rome != 9 and not forced:
        msg = "🚨 [ALERT INTRAYDAY BYPASS] 🚨\n" + msg
        msg = msg[:1400]
        print(f"brief: emergenza rilevata alle ore {hour_rome}, veto orario bypassato.")

    if not os.environ.get("CALLMEBOT_APIKEY"):
        print("brief (dry-run, nessun CALLMEBOT_APIKEY):\n" + msg)
        return
    if send_whatsapp(msg):
        print("brief: inviato")
    else:
        print("!! brief: invio fallito", file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 — ANTI-FRAGILE: mai far fallire il workflow
        print(f"!! morning_brief (best-effort): {e}", file=sys.stderr)
    sys.exit(0)
