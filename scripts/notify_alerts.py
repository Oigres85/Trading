#!/usr/bin/env python3
"""NOTIFICHE ALERT (v113) — best-effort, ANTI-FRAGILE: qualunque cosa succeda qui dentro
(SMTP giù, token scaduto, rete assente) lo script logga e esce SEMPRE 0 — la pipeline
dati non deve mai fallire per colpa di una notifica.

Cosa notifica (solo VARIAZIONI rispetto all'ultimo alert inviato, dedup via
config/alert_state.json committato dal CI):
  - stop trailing VIOLATI su posizioni (critico: richiede decisione oggi);
  - alert di data quality nuovi (dato macro stale/unreliable);
  - nuovi setup [TURNAROUND SQUEEZE RISK] in watchlist (opportunità speculativa).

Canali, in ordine di preferenza (il primo che riesce vince):
  1. WhatsApp via CallMeBot (gratuito ma va attivato UNA volta dall'utente: inviare su
     WhatsApp "I allow callmebot to send me messages" al numero indicato su
     https://www.callmebot.com/blog/free-api-whatsapp-messages/ e mettere la apikey nel
     secret CALLMEBOT_APIKEY). Telefono di default: +39 366 778 0362.
  2. Email SMTP (secret SMTP_PASS obbligatorio; SMTP_HOST/SMTP_USER/SMTP_PORT opzionali,
     default Gmail/Workspace: smtp.gmail.com:587, mittente sergio.garofalo@siigep.tech).
     Destinatario: sergiomariagarofalo@icloud.com (override con MAIL_TO).
  3. Fallback SEMPRE disponibile: GitHub Issue sul repo (GITHUB_TOKEN nativo del workflow)
     → GitHub manda la sua notifica email/app all'owner senza alcun secret.

Lo stato dedup viene aggiornato SOLO se almeno un canale è andato a buon fine: se tutto
fallisce, si ritenta al run successivo."""
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "data.json"
STATE = ROOT / "config" / "alert_state.json"

DEFAULT_TO = "sergiomariagarofalo@icloud.com"
DEFAULT_FROM = "sergio.garofalo@siigep.tech"
DEFAULT_PHONE = "+393667780362"


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


# CallMeBot risponde SEMPRE HTTP 200 (anche su apikey invalida / telefono non attivato): il
# vero esito è nel BODY. Marker osservati sul campo — successo vs errore.
_CALLMEBOT_OK = ("message queued", "message sent", "will receive it", "queued", "sent to")
_CALLMEBOT_ERR = ("invalid", "not valid", "not registered", "not activated", "activate the api",
                  "you need to", "not been activated", "apikey missing", "api key missing",
                  "blocked", "not found", "wasn't able", "was not able", "no permission")


def _callmebot_ok(status, body):
    """L'incidente 'WhatsApp mai arrivato': CallMeBot ritorna 200 anche quando NON invia
    (apikey sbagliata, telefono non attivato) → il vecchio `r.status == 200` credeva d'aver
    inviato. Unico modo affidabile: leggere il BODY. Ritorna (ok, queued, errored):
      • ok = True solo se 200 e NESSUN marker d'errore noto (ottimista sui body sconosciuti:
        il fallimento reale porta sempre un marker d'errore, la cascata copre i falsi negativi);
      • queued/errored = diagnostica loggata in Actions."""
    low = (body or "").lower()
    errored = any(e in low for e in _CALLMEBOT_ERR)
    queued = any(o in low for o in _CALLMEBOT_OK)
    return (status == 200 and not errored), queued, errored


def send_whatsapp(msg):
    key = os.environ.get("CALLMEBOT_APIKEY")
    if not key:
        return False
    phone = os.environ.get("CALLMEBOT_PHONE", DEFAULT_PHONE)
    url = ("https://api.callmebot.com/whatsapp.php?phone=" + urllib.parse.quote(phone)
           + "&apikey=" + urllib.parse.quote(key) + "&text=" + urllib.parse.quote(msg))
    with urllib.request.urlopen(url, timeout=20) as r:
        status = r.status
        body = r.read().decode("utf-8", "replace")
    ok, queued, errored = _callmebot_ok(status, body)
    diag = ("queued" if queued else "nessun marker di successo") + (", ERRORE nel body" if errored else "")
    # il body è loggato (troncato) in Actions: è LÌ che si diagnostica il "mai arrivato"
    print(f"notify: WhatsApp CallMeBot {'ok' if ok else 'FALLITO'} (HTTP {status}, {diag}) "
          f"body={body[:200]!r}", file=sys.stderr if not ok else sys.stdout)
    return ok


def send_test():
    """Modalità --test (diagnostica): invio INCONDIZIONATO (bypassa dedup e soglie) di un
    messaggio di prova su tutti i canali, con esito per-canale. Serve a provare che il canale
    WhatsApp funziona indipendentemente dallo stato di config/alert_state.json."""
    msg = ("✅ Trading Dashboard — TEST NOTIFICHE "
           + datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
           + "\nSe ricevi questo messaggio su WhatsApp, il canale CallMeBot è configurato bene.")
    any_ok = False
    for channel in (send_whatsapp, send_email, send_github_issue):
        try:
            res = bool(channel(msg))
        except Exception as e:  # noqa: BLE001
            res = False
            print(f"!! notify --test {channel.__name__}: {e}", file=sys.stderr)
        print(f"notify --test: {channel.__name__} → {'OK' if res else 'ko / non configurato'}")
        any_ok = any_ok or res
    if not any_ok:
        print("!! notify --test: NESSUN canale riuscito. Checklist WhatsApp: secret "
              "CALLMEBOT_APIKEY presente? CALLMEBOT_PHONE con prefisso +39? Attivazione fatta "
              "(msg 'I allow callmebot to send me messages' al numero CallMeBot)?", file=sys.stderr)
    return any_ok


def send_email(msg):
    pwd = os.environ.get("SMTP_PASS")
    if not pwd:
        return False
    import smtplib
    from email.mime.text import MIMEText
    host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ.get("SMTP_USER", DEFAULT_FROM)
    to = os.environ.get("MAIL_TO", DEFAULT_TO)
    mime = MIMEText(msg, "plain", "utf-8")
    mime["Subject"] = "⚠ Trading Dashboard — alert"
    mime["From"] = user
    mime["To"] = to
    with smtplib.SMTP(host, port, timeout=25) as s:
        s.starttls()
        s.login(user, pwd)
        s.sendmail(user, [to], mime.as_string())
    print(f"notify: email inviata a {to}")
    return True


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
    giorno+testo: un workflow rotto che gira ogni ora non deve spammare WhatsApp."""
    state = _load_state()
    sig = datetime.now(timezone.utc).strftime("%Y-%m-%d") + "|" + text[:120]
    if state.get("last_custom") == sig:
        print("notify: custom già inviato oggi (dedup)")
        return
    msg = "⚠ TRADING DASHBOARD — RED TEAM\n" + text
    for channel in (send_whatsapp, send_email, send_github_issue):
        try:
            if channel(msg):
                state["last_custom"] = sig
                STATE.write_text(json.dumps(state, indent=1))
                return
        except Exception as e:  # noqa: BLE001
            print(f"!! notify {channel.__name__}: {e}", file=sys.stderr)
    print("!! notify custom: nessun canale riuscito", file=sys.stderr)


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
    for channel in (send_whatsapp, send_email, send_github_issue):
        try:
            if channel(msg):
                sent = True
                break
        except Exception as e:  # noqa: BLE001 — canale ko: si passa al successivo
            print(f"!! notify {channel.__name__}: {e}", file=sys.stderr)
    if sent:
        STATE.write_text(json.dumps({"last_alerted": current,
                                     "updated": data.get("updated_at")}, indent=1))
    else:
        print("!! notify: nessun canale disponibile/riuscito — si ritenta al prossimo run",
              file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 — ANTI-FRAGILE: mai bloccare la pipeline
        print(f"!! notify_alerts (best-effort, pipeline NON bloccata): {e}", file=sys.stderr)
    sys.exit(0)
