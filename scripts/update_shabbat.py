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
    old = json.loads(DATA.read_text(encoding="utf-8")) if DATA.exists() else {}
    new = {**old, **found, "source_pdf": pdf.name}
    DATA.write_text(json.dumps(new, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    shutil.copyfile(pdf, WEEKLY / "latest.pdf")
    missing = [k for k in ("parasha", "candles", "havdala", "friday") if k not in found]
    print(f"updated from {pdf.name}: {len(found)} fields" + (f"; NOT found: {missing}" if missing else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
