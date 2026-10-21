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
    m = re.search(r"שבת קודש (פרשת [^\n]+?) ([א-ת\"']+ [א-ת]+) תשפ\"?([א-ת])", norm)
    if m:
        out["parasha"] = m.group(1).strip()
        out["hebrew_date"] = f"{m.group(2).strip()} תשפ\"{m.group(3)}"
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
        m = re.search(re.escape(label) + r" ?" + TIME + r"\s*" + TIME + "?", norm)
        if m:
            z[label] = m.group(1)
            if m.group(2): z2[label] = m.group(2)
    if len(z) >= 5:
        out["zmanim"] = z
        if len(z2) == len(z):
            out["zmanim_next"] = z2
            # the two column headers: "יום ו' ה' מרחשוון" ... "יום ו' י"ב מרחשוון"
            head = norm[norm.find("זמני השבוע"):norm.find("עלות השחר")] if "זמני השבוע" in norm else ""
            head = re.sub(r"\s+", " ", head.replace("\n", " "))
            MONTH = r"(תשרי|מרחשוון|חשוון|חשון|כסלו|טבת|שבט|אדר א'|אדר ב'|אדר|ניסן|אייר|סיוון|סיון|תמוז|מנחם אב|אב|אלול)"
            dates = re.findall(r"([א-ת]\"[א-ת]|[א-ת]') ?" + MONTH, head)
            if len(dates) >= 2:
                out["zmanim_dates"] = [f"{d} {mo}" for d, mo in dates[:2]]

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
    labels = sorted({f[0] for f in frags if f[1] > 470 and re.search(r"מני?ין", f[2])}, reverse=True)
    mincha = [f[0] for f in frags if f[1] > 470 and f[2] == "מנחה"]
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
        frs = sorted(row(y, 265, 438), key=lambda f: -f[1])
        raw = " ".join(f[2] for f in frs)
        raw = re.sub(r"(\d{2})\s*(\d{1,2}:)", r"\2\1", raw)            # "30 5:" -> "5:30"
        raw = re.sub(r"(\d{1,2}:)\s+(\d{2})", r"\1\2", raw)
        if not raw.strip():
            return ""
        groups = []
        for g in raw.split(";"):
            tm = re.findall(r"\d{1,2}:\d{2}", g)
            words = re.sub(r"ב?\s*י\s*ו?\s*מ?\s*י?\s*ם", " ", g)            # "יום"/"ימים"/"בימים", also split into letters ("י ו ם")
            words = re.sub(r"\d{1,2}:\d{2}|בלבד|[()\-,;'\"]", " ", words)
            days = [c for c in re.findall(r"[א-ו]", re.sub(r"[א-ת]{2,}", " ", words))]
            days = list(dict.fromkeys(days))
            if days or tm:
                groups.append((days, tm[0] if tm else ""))
        if not groups:
            return ""
        fmt = lambda ds: ", ".join(d + "'" for d in ds)
        if "בלבד" in raw and not any(t for _, t in groups):
            return fmt([d for ds, _ in groups for d in ds]) + " בלבד"
        return " · ".join((fmt(ds) + ": " if ds else "") + t for ds, t in groups if ds or t)

    def name_at(y):
        txt = " ".join(f[2] for f in row(y, 470, 600))
        m = re.search(r"מני?ין\s*([א-ט])", txt)
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
    except Exception as e:
        print(f"weekday minyanim not read: {e}")
    old = json.loads(DATA.read_text(encoding="utf-8")) if DATA.exists() else {}
    new = {**old, **found, "source_pdf": pdf.name}
    DATA.write_text(json.dumps(new, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    shutil.copyfile(pdf, WEEKLY / "latest.pdf")
    missing = [k for k in ("parasha", "candles", "havdala", "friday") if k not in found]
    print(f"updated from {pdf.name}: {len(found)} fields" + (f"; NOT found: {missing}" if missing else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
