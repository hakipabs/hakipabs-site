#!/usr/bin/env python3
"""Community archive: every folder under archive/ is a collection (photos and scanned documents).

archive/<collection>/album.json describes it:
  {"title", "period" (free text, e.g. "שנות ה-60"), "year_sort" (number, for ordering), "description",
   "contributor", "approved": true|false, "cover",
   "items": {"<file>": {"caption", "year", "text" (optional full transcription, Markdown-ish plain text)}}}
Only approved collections are published. Images are resized (web 1600px, thumb 480px).
A PDF becomes one item per page (rendered to JPEG), each linking to the PDF; the "text" of the
document is attached to its first page. Output: data/archive.json.
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARC = ROOT / "archive"
DATA = ROOT / "data" / "archive.json"
IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
WEB_MAX, THUMB = 1600, 480


def save_pair(im, w_out, t_out):
    from PIL import Image, ImageOps
    im.save(w_out, quality=84, optimize=True, progressive=True)
    ImageOps.fit(im, (THUMB, THUMB), Image.LANCZOS, centering=(0.5, 0.35)).save(t_out, quality=80, optimize=True)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    from PIL import Image, ImageOps
    collections = []
    for folder in sorted(p for p in ARC.iterdir() if p.is_dir() and not p.name.startswith(".")):
        meta = {}
        mf = folder / "album.json"
        if mf.exists():
            try:
                meta = json.loads(mf.read_text(encoding="utf-8"))
            except Exception as e:
                print(f"bad album.json in {folder.name}: {e}")
        if not meta.get("approved", False):
            print(f"skipped (not approved): {folder.name}")
            continue
        web, thumb = folder / "web", folder / "thumb"
        web.mkdir(exist_ok=True); thumb.mkdir(exist_ok=True)
        items_meta = meta.get("items", {})
        items, keep = [], set()
        files = sorted(x for x in folder.iterdir() if x.is_file() and (x.suffix.lower() in IMG_EXTS or x.suffix.lower() == ".pdf"))
        for f in files:
            m = items_meta.get(f.name, {})
            if f.suffix.lower() == ".pdf":
                import pymupdf
                doc = pymupdf.open(str(f))
                n = len(doc)
                for i in range(n):
                    stem = f"{f.stem}-p{i + 1}"
                    w_out, t_out = web / f"{stem}.jpg", thumb / f"{stem}.jpg"
                    keep.add(w_out.name)
                    if not w_out.exists() or w_out.stat().st_mtime < f.stat().st_mtime:
                        page = doc[i]
                        zoom = WEB_MAX / page.rect.width
                        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
                        im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                        save_pair(im, w_out, t_out)
                        print(f"rendered {folder.name}/{f.name} page {i + 1}")
                    cap = m.get("caption", f.stem)
                    items.append({
                        "web": f"archive/{folder.name}/web/{w_out.name}",
                        "thumb": f"archive/{folder.name}/thumb/{t_out.name}",
                        "file": f"archive/{folder.name}/{f.name}",
                        "caption": cap if n == 1 else f"{cap} (עמוד {i + 1} מתוך {n})",
                        "year": m.get("year", ""),
                        "text": m.get("text", "") if i == 0 else "",
                        "kind": "document",
                        "group": f.stem,
                    })
            else:
                w_out, t_out = web / (f.stem + ".jpg"), thumb / (f.stem + ".jpg")
                keep.add(w_out.name)
                if not w_out.exists() or w_out.stat().st_mtime < f.stat().st_mtime:
                    im = ImageOps.exif_transpose(Image.open(f)).convert("RGB")
                    im.thumbnail((WEB_MAX, WEB_MAX), Image.LANCZOS)
                    save_pair(im, w_out, t_out)
                    print(f"rendered {folder.name}/{f.name}")
                items.append({
                    "web": f"archive/{folder.name}/web/{w_out.name}",
                    "thumb": f"archive/{folder.name}/thumb/{t_out.name}",
                    "file": "",
                    "caption": m.get("caption", ""),
                    "year": m.get("year", ""),
                    "text": m.get("text", ""),
                    "kind": "photo",
                    "group": "",
                })
        for d in (web, thumb):
            for s in d.glob("*.jpg"):
                if s.name not in keep:
                    s.unlink()
        if not items:
            continue
        collections.append({
            "slug": folder.name,
            "title": meta.get("title") or re.sub(r"[-_]+", " ", folder.name),
            "period": meta.get("period", ""),
            "year_sort": meta.get("year_sort", 9999),
            "description": meta.get("description", ""),
            "contributor": meta.get("contributor", ""),
            "cover": meta.get("cover") or items[0]["thumb"],
            "count": len(items),
            "items": items,
        })
    collections.sort(key=lambda c: (c["year_sort"], c["title"]))
    DATA.write_text(json.dumps({"collections": collections}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"archive.json: {len(collections)} collection(s), {sum(c['count'] for c in collections)} item(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
