#!/usr/bin/env python3
"""Holiday schedule sheets: render every PDF in holidays/ to a JPEG and list them in data/holidays.json.

The sheets are free-form layouts, so they are shown as images (click opens the PDF) rather than parsed.
An entry is shown on the site for `show_days` days after it was added (default 45), unless the JSON
entry carries an explicit "until": "YYYY-MM-DD". Deleting the PDF removes the entry.
The title comes from the file name (which the mail script derives from the email subject);
a title already present in holidays.json is kept, so it can be corrected by hand.
"""
import json, re, subprocess, sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOL = ROOT / "holidays"
DATA = ROOT / "data" / "holidays.json"
SHOW_DAYS = 45
WIDTH_PX = 1400


def added_on(p):
    out = subprocess.run(["git", "log", "--diff-filter=A", "--follow", "-1", "--format=%cs", "--", str(p)],
                         capture_output=True, text=True, cwd=ROOT).stdout.strip()
    return out or date.today().isoformat()


def title_for(stem):
    s = re.sub(r"[-_]?\d{4}-\d{2}-\d{2}$", "", stem)            # drop the date suffix
    s = s.replace("-", " ").replace("_", " ").strip()
    # restore the gershayim in a Hebrew year the file name lost: תשפז -> תשפ"ז
    s = re.sub(r"\b(תש[א-ת]{1,2})([א-ת])\b", lambda m: m.group(1) + '"' + m.group(2), s)
    return s or "לוח זמנים"


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    import pymupdf
    old = {}
    if DATA.exists():
        old = {e["pdf"]: e for e in json.loads(DATA.read_text(encoding="utf-8")).get("items", [])}
    items = []
    for pdf in sorted(HOL.glob("*.pdf")):
        img = pdf.with_suffix(".jpg")
        if not img.exists() or img.stat().st_mtime < pdf.stat().st_mtime:
            page = pymupdf.open(str(pdf))[0]
            zoom = WIDTH_PX / page.rect.width
            page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False).save(str(img), jpg_quality=82)
            print(f"rendered {img.name}")
        prev = old.get(f"holidays/{pdf.name}", {})
        items.append({
            "title": prev.get("title") or title_for(pdf.stem),
            "pdf": f"holidays/{pdf.name}",
            "image": f"holidays/{img.name}",
            "added": prev.get("added") or added_on(pdf),
            "until": prev.get("until", ""),
        })
    keep = {Path(e["image"]).name for e in items}
    for stray in list(HOL.glob("*.jpg")) + list(HOL.glob("*.png")):
        if stray.name not in keep:
            stray.unlink()
            print(f"removed {stray.name}")
    items.sort(key=lambda e: e["added"], reverse=True)
    DATA.write_text(json.dumps({"show_days": SHOW_DAYS, "items": items}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"holidays.json: {len(items)} item(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
