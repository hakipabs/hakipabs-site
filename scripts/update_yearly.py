#!/usr/bin/env python3
"""Read the newest yearly candle-lighting PDF in yearly/ and write data/yearly.json.

Each PDF line looks like:  "8. נח שבת ו חשון 17:46 18:47"  or
"2. ב' דראש השנה ראשון ב תשרי לא לפני 19:31 19:30" or "10. וירא שבת כ חשון 16:32 17:33 שעון חורף".
Rows the parser cannot read are kept verbatim in a "raw" field so nothing is silently lost.
"""
import json, re, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
YEARLY = ROOT / "yearly"
DATA = ROOT / "data" / "yearly.json"
TIME = r"\d{1,2}:\d{2}"
WEEKDAYS = {"ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"}
MONTHS = {"תשרי", "חשון", "חשוון", "מרחשוון", "כסלו", "טבת", "שבט", "אדר", "ניסן", "אייר", "סיון", "סיוון", "תמוז", "אב", "אלול"}


def newest_pdf():
    pdfs = [p for p in YEARLY.glob("*.pdf") if p.name != "latest.pdf"]
    if not pdfs:
        return None
    def committed(p):
        out = subprocess.run(["git", "log", "-1", "--format=%ct", "--", str(p)],
                             capture_output=True, text=True, cwd=ROOT).stdout.strip()
        return int(out) if out else int(p.stat().st_mtime)
    return max(pdfs, key=lambda p: (committed(p), p.stat().st_mtime))


def parse_row(line):
    m = re.match(r"^\s*(\d+)\.\s*(.*?)\s*(" + TIME + r")\s*(" + TIME + r")?\s*(.*?)\s*$", line)
    if not m:
        return None
    n, head, t1, t2, tail = m.groups()
    row = {"n": int(n), "candles": t1, "havdala": t2 or "", "note": tail.strip()}
    if "לא לפני" in head:
        head = head.replace("לא לפני", "").strip()
        row["candles_note"] = "לא לפני"
    toks = head.split()
    # Hebrew date = [day] [month] with Adar possibly followed by א/ב
    hdate, weekday = "", ""
    if len(toks) >= 2 and toks[-1] in ("א", "ב") and len(toks) >= 3 and toks[-2] == "אדר":
        hdate = " ".join(toks[-3:]); toks = toks[:-3]
    elif len(toks) >= 2 and toks[-1] in MONTHS:
        hdate = " ".join(toks[-2:]); toks = toks[:-2]
    if toks and toks[-1] in WEEKDAYS:
        weekday = toks[-1]; toks = toks[:-1]
    row["title"] = re.sub(r"\s*-\s*", " - ", " ".join(toks)).replace(" - ", " · ").strip(" ·")
    row["weekday"], row["hdate"] = weekday, hdate
    return row


def parse(text):
    norm = re.sub(r"[ \t]+", " ", text.replace("‏", ""))
    m = re.search(r"זמני הדלקת נרות (תש[א-ת]\"[א-ת])", norm)
    year = m.group(1) if m else ""
    rows, raw = [], []
    for line in norm.splitlines():
        if not re.match(r"^\s*\d+\.", line):
            continue
        r = parse_row(line)
        (rows if r and r.get("title") and r.get("hdate") else raw).append(r or line.strip())
    return {"year": year, "rows": rows, "unparsed": raw}


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    pdf = newest_pdf()
    if not pdf:
        print("no PDF in yearly/"); return 0
    from pypdf import PdfReader
    text = "\n".join(p.extract_text() or "" for p in PdfReader(str(pdf)).pages)
    data = parse(text)
    if len(data["rows"]) < 40:
        print(f"only {len(data['rows'])} rows parsed from {pdf.name}; keeping the existing yearly.json")
        return 1
    data["source_pdf"] = pdf.name
    DATA.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    shutil.copyfile(pdf, YEARLY / "latest.pdf")
    print(f"updated from {pdf.name}: year {data['year']}, {len(data['rows'])} rows, {len(data['unparsed'])} unparsed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
