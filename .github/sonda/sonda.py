import io, json, re, sys, time, zipfile, csv, urllib.request, urllib.error
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"}
def get(url, timeout=90):
    req = urllib.request.Request(url, headers=UA)
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = r.read()
            return r.status, b, r.headers.get("Content-Type"), round(time.time() - t, 1)
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:300], e.headers.get("Content-Type"), round(time.time() - t, 1)
    except Exception as e:
        return None, repr(e).encode()[:300], None, round(time.time() - t, 1)

NOMI = re.compile(r"coreweave|oracle|nvidia|advanced micro|hynix|italy|italian|tesla|alphabet|amazon|broadcom|space", re.I)
print("=== DTCC SEC cumulative credits ===")
fatto = False
for d in ["2026_10_16", "2026_10_15", "2026_09_15", "2026_07_15", "2026_04_15", "2025_10_15"]:
    for base in ["https://pddata.dtcc.com/ppd/api/report/cumulative/sec/SEC_CUMULATIVE_CREDITS_%s.zip"]:
        u = base % d
        st, b, ct, dt = get(u)
        print(d, st, len(b), ct, dt, "s", b[:120] if st != 200 else b"")
        if st == 200 and not fatto and b[:2] == b"PK":
            fatto = True
            z = zipfile.ZipFile(io.BytesIO(b))
            print("files", z.namelist())
            txt = z.read(z.namelist()[0]).decode("utf-8", "replace")
            rows = list(csv.DictReader(io.StringIO(txt)))
            print("righe", len(rows))
            print("colonne", list(rows[0].keys()) if rows else None)
            for k in list(rows[0].keys()) if rows else []:
                kl = k.lower()
                if any(w in kl for w in ("product", "notation", "underl", "asset", "name", "tenor", "currency")):
                    vals = {}
                    for r in rows:
                        vals[r[k]] = vals.get(r[k], 0) + 1
                    top = sorted(vals.items(), key=lambda x: -x[1])[:12]
                    print("  ", k, "->", top)
            n = 0
            for r in rows:
                s = " | ".join(v for v in r.values() if v)
                if NOMI.search(s):
                    print("  MATCH", json.dumps({k: v for k, v in r.items() if v}, ensure_ascii=False)[:1500])
                    n += 1
                    if n >= 25:
                        break
            print("match stampati", n)
            print("ESEMPIO RIGA", json.dumps({k: v for k, v in rows[0].items() if v}, ensure_ascii=False)[:1500] if rows else None)
print("=== DTCC dashboard ===")
st, b, ct, dt = get("https://pddata.dtcc.com/ppd/secdashboard")
print(st, len(b), ct, dt)
if st == 200:
    print(sorted(set(re.findall(rb"[\w./-]*api/[\w./{}-]+", b)))[:40])
print("=== Wayback ICE ===")
st, b, ct, dt = get("https://web.archive.org/cdx/search/cdx?url=ice.com/api/cds-settlement-prices/*&output=json&limit=100")
print(st, len(b), ct, dt)
print(b[:3000].decode("utf-8", "replace"))
