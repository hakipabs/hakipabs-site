#!/usr/bin/env python3
"""Read the newest weekly sheet PDF in weekly/ and refresh data/shabbat.json.

Anything the parser cannot find keeps its previous value, so a layout change in the
PDF degrades to "last week's number stays" rather than a broken page.
Also copies the newest PDF to weekly/latest.pdf, which the site links to.
"""
import json, re, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEEKLY = ROOT / "weekly"
DATA = ROOT / "data" / "shabbat.json"
TIME = r"(\d{1,2}:\d{2})"

SHABBAT_LABELS = [
    "מנחה גדולה (שישי)", "מנחה וקב\"ש בהיכל", "מנחה וקב\"ש בביהמ\"ד",
    "שחרית א' בביהמ\"ד", "שחרית ב' (הודו) בהיכל",
    "מנחה א'", "מנחה ב'", "מנחה ג'", "ערבית א'", "ערבית ב'",
]
ZMANIM = ["עלות השחר", "טלית ותפילין", "הנץ החמה", "סוף זמן ק\"ש מג\"א",
          "סוף זמן ק\"ש גר\"א", "סוף זמן תפילה", "חצות היום", "מנחה גדולה", "שקיעת החמה"]


STOP_HEADERS = ("קידוש לבנה", "זמני השבוע", "מניין ב", "במוצא", "שחרית מנין", "שיעורים יומיים", "זמני תפילות")
CLOSERS = ("יהי רצון", "המקום ינחם", "תנצב\"ה", "ה' יאריך", "שלא תדעו")


def block_after(norm, header_re):
    """Collect '*' items (and a closing blessing) after a header line such as 'מזל טוב' or 'כוס תנחומים'."""
    m = re.search(header_re, norm)
    if not m:
        return None
    items, closing, blanks = [], "", 0
    for line in norm[m.end():].splitlines()[1:]:
        t = line.strip()
        if not t or t == "*":
            blanks += 1
            if items and blanks >= 2:
                break
            continue
        blanks = 0
        if any(t.startswith(h) for h in STOP_HEADERS):
            break
        if t.startswith("*"):
            items.append(re.sub(r"\s+", " ", t.lstrip("* ").strip(" .")).replace(" ב ת ", " בת ") + ".")
        elif any(t.startswith(c) for c in CLOSERS):
            closing = re.sub(r"\s+", " ", t).strip()
        elif items:
            items[-1] = (items[-1].rstrip(".") + " " + t.strip(" .")).strip() + "."
        else:
            break
    return {"items": items, "closing": closing} if items else None


def newest_pdf():
    pdfs = [p for p in WEEKLY.glob("*.pdf") if p.name != "latest.pdf"]
    if not pdfs:
        return None
    def committed(p):
        out = subprocess.run(["git", "log", "-1", "--format=%ct", "--", str(p)],
                             capture_output=True, text=True, cwd=ROOT).stdout.strip()
        return int(out) if out else int(p.stat().st_mtime)
    return max(pdfs, key=lambda p: (committed(p), p.stat().st_mtime))


def parse(text):
    t = text.replace("‏", "")
    norm = re.sub(r"[ \t]+", " ", t)
    out = {}
    m = re.search(r"שבת קודש\s+(פרשו?ת\s+[^\n]+?)\s+([א-ת]{1,2}[\"'׳״]?[א-ת]?[\"'׳]?)\s+(אדר [אב]'|[א-ת]+(?:-[א-ת]+)?)\s+תשפ\"?([א-ת])", norm)
    if m:
        out["parasha"] = re.sub(r"\s*-\s*", "-", re.sub(r"\s+", " ", m.group(1))).strip()
        out["hebrew_date"] = f"{m.group(2).strip()} {m.group(3).replace('-', ' ')} תשפ\"{m.group(4)}"
    m = re.search(r"הפטרה: ?\"([^\"]+)\"", norm)
    if m: out["haftara"] = m.group(1).strip()
    m = re.search(r"הדלקת נרות " + TIME, norm)
    if m: out["candles"] = m.group(1)
    m = re.search(r"צאת השבת " + TIME, norm)
    if m: out["havdala"] = m.group(1)
    m = re.search(r"ר\"ת ?" + TIME, norm)
    if m: out["rabbeinu_tam"] = m.group(1)

    # Ten Shabbat prayer times appear as a column of times right after the label column.
    seg = norm.split("זמני תפילות", 1)
    if len(seg) == 2:
        times = []
        started = False
        for line in seg[1].splitlines():
            s = line.strip()
            if re.fullmatch(TIME, s):
                times.append(s); started = True
            elif started and not re.fullmatch(r"-+", s):
                break
        if len(times) == len(SHABBAT_LABELS):
            rows = list(zip(SHABBAT_LABELS, times))
            out["friday"], out["shabbat"] = rows[:5], rows[5:]

    m = re.search(r"\nמנחה " + TIME, norm)
    if m: out["weekday_mincha"] = m.group(1)

    z, z2 = {}, {}
    for label in ZMANIM:
        m = re.search(re.escape(label).replace('"', '"?') + r" ?" + TIME + r"\s*" + TIME + "?", norm)   # tolerate a missing quote ("מגא")
        if m:
            z[label] = m.group(1)
            if m.group(2): z2[label] = m.group(2)
    if len(z) >= 5:
        out["zmanim"] = z
        if len(z2) == len(z):
            out["zmanim_next"] = z2
            # the two column headers: "יום ו' ה' מרחשוון" ... "יום ו' י"ב מרחשוון"
            i0 = norm.find("זמני השבוע")
            head = norm[i0:norm.find("עלות השחר", i0)] if i0 >= 0 else ""   # "עלות השחר" may also appear earlier, in a note
            head = re.sub(r"\s+", " ", head.replace("\n", " "))
            head = re.sub(r"([א-ת]) (['\"])", r"\1\2", head).replace('מנ"א', "מנחם אב")   # "ח ' אלול", "י' מנ"א\"
            MONTH = r"(תשרי|מרחשוון|חשוון|חשון|כסלו|טבת|שבט|אדר א'|אדר ב'|אדר|ניסן|אייר|סיוון|סיון|תמוז|מנחם[ \-]אב|אב|אלול)"
            dates = re.findall(r"([א-ת]\"[א-ת]|[א-ת]') ?" + MONTH, head)
            if len(dates) >= 2:
                out["zmanim_dates"] = [f"{d} {mo.replace('-', ' ')}" for d, mo in dates[:2]]

    m = re.search(r"דבר תורה: ?([^\n]+)", norm)
    foot = []
    if m: foot.append("דבר תורה: " + re.sub(r"\s+", " ", m.group(1)).strip())
    if "קידוש לבנה" in norm: foot.append("קידוש לבנה במוצאי שבת")
    if foot: out["footnote"] = " · ".join(foot)

    notes = []
    m = re.search(r"מתחילים לבקש\s*\n?\s*\"([^\"]+)\"", norm)
    if m: notes.append(f"במוצאי שבת מתחילים לבקש \"{m.group(1)}\"")
    m = re.search(r"במוצא[\"״]?ש\s+עוברים\s+לשעון\s+(חורף|קיץ)", norm)
    if m: notes.append(f"במוצאי שבת עוברים לשעון {m.group(1)}")
    m = re.search(r"מניין\s*ב\s*(?:ב\s*)?יום\s+(\S+)\s+מתחילים\s+את\s+התפילה\s+עם\s+סליחות\s+בה[\"״]ב", norm)
    if m: notes.append(f"ביום {m.group(1)} מניין ב' מתחיל בסליחות בה\"ב")
    out["note"] = " · ".join(notes)

    m = re.search(r"תפילת ילדים[^\n]*?" + TIME, norm)
    if m: out["kids_tefila"] = m.group(1)

    mt = block_after(norm, r"מזל\s*טוב")
    out["mazal_tov"] = mt or {"items": [], "closing": ""}
    nc = block_after(norm, r"(כוס\s*תנחומים|ניחומים|תנחומים)")
    out["nichumim"] = nc or {"items": [], "closing": ""}

    return out


# Labels seen across a year of sheets. A label whose letters match one of these (ignoring spaces and
# brackets, which the PDF sometimes splits) is written the canonical way.
KNOWN_LABELS = ["מנחה גדולה (שישי)", "מנחה וקב\"ש מוקדמת", "מנחה וקב\"ש בהיכל", "מנחה וקב\"ש בביהמ\"ד",
                "שחרית א' בביהמ\"ד", "שחרית א' (הודו) בביהמ\"ד", "שחרית ב' (הודו) בהיכל", "שחרית ב' היכל אהרן (הודו)",
                "מנחה א'", "מנחה ב'", "מנחה ג'", "מנחה ד'", "ערבית א'", "ערבית ב'"]
_KEY = lambda t: re.sub(r"[\s()\[\]]", "", t)
_CANON = {_KEY(l): l for l in KNOWN_LABELS}


def shabbat_times(pdf):
    """The "זמני תפילות" box read by position: label column on the right, time column next to it,
    dashed rows split Friday / Shabbat morning / afternoon / Arvit. Returns {} if not recognised."""
    from pypdf import PdfReader
    frags = []
    def visit(text, cm, tm, fd, fs):
        t = text.strip()
        if t:
            frags.append((round(tm[5] * cm[3] + cm[5] if cm else tm[5], 1), round(tm[4] * cm[0] + cm[4] if cm else tm[4], 1), t))
    PdfReader(str(pdf)).pages[0].extract_text(visitor_text=visit)
    head = [f for f in frags if "זמני תפילות" in f[2]]
    stop = [f[0] for f in frags if re.search(r"מזל טוב|ימי השבוע|זמני השבוע", f[2])]
    if not head:
        return {}
    y_top = head[0][0]
    y_bot = max([y for y in stop if y < y_top] or [0])
    tx = [f[1] for f in frags if y_bot < f[0] < y_top and f[1] > 330 and re.fullmatch(r"\d{1,2}:(\d{2})?|\d{2}", f[2])]   # right half only: the left column has class times
    if not tx:
        return {}
    col = sorted(tx)[len(tx) // 2]                    # x of the time column
    rows = sorted({f[0] for f in frags if y_bot < f[0] < y_top and f[1] > col + 30}, reverse=True)
    groups, cur = [], []
    for y in rows:
        line = [f for f in frags if abs(f[0] - y) < 0.6]
        lab = [f for f in line if f[1] > col + 30]
        if any(re.fullmatch(r"-{3,}", f[2]) for f in lab):
            if cur: groups.append(cur); cur = []
            continue
        tparts = sorted([f for f in line if col - 15 <= f[1] <= col + 30 and re.fullmatch(r"[\d:]+", f[2])], key=lambda f: f[1])
        t = "".join(f[2] for f in tparts)
        mt = re.fullmatch(r"(\d{1,2}):?(\d{2})", t) or re.fullmatch(r"(\d{2})(\d{1,2}):", t)
        if not mt:
            continue
        hh, mm = (mt.group(1), mt.group(2)) if ":" not in t or t.index(":") < 3 and not t.endswith(":") else (mt.group(2), mt.group(1))
        label = " ".join(f[2] for f in sorted(lab, key=lambda f: (-f[1], f[2] in ("'", "[", "]"))))
        label = re.sub(r"\s*[\[\]()]\s*", " ", label)                 # brackets come out reversed: drop them...
        label = re.sub(r"(?<!\()הודו(?!\))", "(הודו)", label)          # ...and wrap the one word that has them
        label = re.sub(r"\s+'", "'", label)
        label = _CANON.get(_KEY(label), label)
        label = re.sub(r"\s+", " ", label.replace("ותפילת ", "ו").replace("יום שישי", "(שישי)")).strip()
        cur.append([label, f"{int(hh)}:{mm}"])
    if cur: groups.append(cur)
    if len(groups) < 3 or sum(len(g) for g in groups) < 6:
        return {}
    fri = groups[0] + groups[1]
    sat = [r for g in groups[2:] for r in g]
    return {"friday": fri, "shabbat": sat}


def weekday_minyanim(pdf):
    """Weekday Shacharit and Arvit rows from the "ימי השבוע" box, read by position on the page
    (plain text extraction scrambles the RTL notes). Returns {} when the layout is not recognised."""
    from pypdf import PdfReader
    frags = []
    def visit(text, cm, tm, fd, fs):
        t = text.strip()
        if t:
            y = tm[5] * cm[3] + cm[5] if cm else tm[5]
            x = tm[4] * cm[0] + cm[4] if cm else tm[4]
            frags.append((round(y, 1), round(x, 1), t))
    PdfReader(str(pdf)).pages[0].extract_text(visitor_text=visit)
    row = lambda y0, x0, x1: [f for f in frags if abs(f[0] - y0) < 0.6 and x0 <= f[1] < x1]
    rowtext = lambda y: "".join(f[2] for f in frags if abs(f[0] - y) < 0.6 and f[1] > 470).replace(" ", "")
    labels = sorted({f[0] for f in frags if f[1] > 470 and re.search(r"מני?ין", rowtext(f[0]))}, reverse=True)
    # the weekday "מנחה" row sits between the Shacharit and Arvit minyanim (the Shabbat box has its own "מנחה" rows)
    mincha = [f[0] for f in frags if f[1] > 470 and f[2] == "מנחה" and labels and min(labels) < f[0] < max(labels)]
    if not labels or not mincha:
        return {}
    my = mincha[0]

    def time_at(y):
        t = "".join(f[2] for f in sorted(row(y, 438, 470), key=lambda f: f[1]))
        m = re.search(r"\d{1,2}:\d{2}", t)
        return m.group(0) if m else ""

    def note_at(y):
        """The side note of a minyan row, rebuilt by meaning: groups of days and their time,
        e.g. "ב', ה': 5:30" / "ב': 5:40 · ה': 5:50" / "א', ו' בלבד" (the PDF stores it in visual order)."""
        frs = sorted([f for f in frags if abs(f[0] - y) < 0.35 and 245 <= f[1] < 438], key=lambda f: (-f[1], 0 if f[2].startswith(";") else 1))   # same baseline only
        raw = " ".join(f[2] for f in frs)
        raw = re.sub(r"(\d{2})\s*(\d{1,2}:)", r"\2\1", raw)            # "30 5:" -> "5:30"
        raw = re.sub(r"(\d{1,2}:)\s+(\d{2})", r"\1\2", raw)
        if not raw.strip():
            return ""
        groups = []
        for g in raw.split(";"):
            tm = re.findall(r"\d{1,2}:\d{2}", g)
            rc = ' ר"ח' if re.search(r'ר"ח', g) else ""                 # "[ר\"ח]" = on Rosh Chodesh
            g = g.replace('ר"ח', " ")
            words = re.sub(r"ב?\s*י\s*ו?\s*מ?\s*י?\s*ם", " ", g)            # "יום"/"ימים"/"בימים", also split into letters ("י ו ם")
            words = re.sub(r"\d{1,2}:\d{2}|בלבד|[()\-,;'\"]", " ", words)
            days = [c for c in re.findall(r"[א-ו]", re.sub(r"[א-ת]{2,}", " ", words))]
            days = list(dict.fromkeys(days))
            if days or tm:
                groups.append((days, tm[0] if tm else "", rc))
        if not groups:
            return ""
        fmt = lambda ds: ", ".join(d + "'" for d in ds)
        if "בלבד" in raw and not any(t for _, t, _ in groups):
            return fmt([d for ds, _, _ in groups for d in ds]) + " בלבד"
        return " · ".join((fmt(ds) + rc + (": " if t else "") if ds else "") + t for ds, t, rc in groups if ds or t)

    def name_at(y):
        txt = "".join(f[2] for f in sorted(row(y, 470, 600), key=lambda f: -f[1])).replace(" ", "")   # "מ" + "נין ו'" -> "מניןו'"
        m = re.search(r"מני?ין([א-ט])", txt)
        return f"מניין {m.group(1)}'" if m else ""

    sh, ar = [], []
    for y in labels:
        n, t = name_at(y), time_at(y)
        if not n or not t:
            continue
        (sh if y > my else ar).append({"name": n, "time": t, **({"note": note_at(y)} if y > my and note_at(y) else {})})
    res = {}
    if len(sh) >= 4: res["weekday_shacharit"] = sh
    if len(ar) >= 3: res["weekday_arvit"] = ar
    return res


_GEM = {"א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5, "ו": 6, "ז": 7, "ח": 8, "ט": 9, "י": 10, "כ": 20, "ל": 30}


def heb_day(text):
    """Day of month from a Hebrew date's first word ("י"ג מרחשוון" -> 13), or None."""
    tok = re.sub(r"[\"'׳״]", "", ((text or "").split() or [""])[0])
    return sum(_GEM[c] for c in tok) if tok and all(c in _GEM for c in tok) else None


def sanity_checks(d):
    """Cross-checks that need no second parser: the sheet against itself and against the yearly table.
    Returns human-readable warnings (Hebrew) for the report mail; an empty list means all agree."""
    warn = []
    hd, zd = heb_day(d.get("hebrew_date")), heb_day((d.get("zmanim_dates") or [""])[0])
    if hd and zd and zd + 1 != hd and not (zd >= 29 and hd == 1):
        warn.append(f"התאריך בכותרת הדף ({d['hebrew_date']}) לא מתאים לטבלת זמני השבוע (יום שישי {d['zmanim_dates'][0]})")
    mins = lambda t: int(t.split(":")[0]) * 60 + int(t.split(":")[1]) if t and re.fullmatch(r"\d{1,2}:\d{2}", t) else None
    c, h = mins(d.get("candles")), mins(d.get("havdala"))
    if c and h and not (55 <= h - c <= 75):
        warn.append(f"בין הדלקת נרות ({d['candles']}) לצאת השבת ({d['havdala']}) יש {h - c} דקות, חריג")
    yf = ROOT / "data" / "yearly.json"
    if yf.exists() and d.get("parasha") and d.get("hebrew_date"):
        y = json.loads(yf.read_text(encoding="utf-8"))
        if y.get("year") and y["year"] in d["hebrew_date"]:
            key = lambda t: re.sub(r"[^א-ת]", "", re.sub(r"^פרשו?ת\s+", "", t or ""))
            p = key(d["parasha"])
            row = next((r for r in y.get("rows", []) if r.get("weekday") == "שבת" and p and (key(r["title"]).startswith(p) or p.startswith(key(r["title"])))), None)
            if row:
                if row.get("candles") and d.get("candles") and row["candles"] != d["candles"]:
                    warn.append(f"הדלקת נרות בדף {d['candles']}, בלוח השנתי {row['candles']}")
                if row.get("havdala") and d.get("havdala") and row["havdala"] != d["havdala"]:
                    warn.append(f"צאת השבת בדף {d['havdala']}, בלוח השנתי {row['havdala']}")
                yd = heb_day(row.get("hdate"))
                if yd and hd and yd != hd:
                    warn.append(f"התאריך בכותרת הדף ({d['hebrew_date']}) שונה מהלוח השנתי ({row['hdate']})")
    return warn


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    pdf = newest_pdf()
    if not pdf:
        print("no PDF in weekly/"); return 0
    from pypdf import PdfReader
    text = "\n".join(p.extract_text() or "" for p in PdfReader(str(pdf)).pages)
    found = parse(text)
    try:
        found.update(weekday_minyanim(pdf))
        found.update(shabbat_times(pdf))
    except Exception as e:
        print(f"weekday minyanim not read: {e}")
    old = json.loads(DATA.read_text(encoding="utf-8")) if DATA.exists() else {}
    found["checks"] = sanity_checks({**old, **found})
    if found["checks"]: print("CHECKS: " + " | ".join(found["checks"]))
    new = {**old, **found, "source_pdf": pdf.name}
    DATA.write_text(json.dumps(new, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    shutil.copyfile(pdf, WEEKLY / "latest.pdf")
    missing = [k for k in ("parasha", "candles", "havdala", "friday") if k not in found]
    print(f"updated from {pdf.name}: {len(found)} fields" + (f"; NOT found: {missing}" if missing else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
