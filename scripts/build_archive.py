#!/usr/bin/env python3
"""Community archive: every folder under archive/ is a collection (photos and scanned documents).

archive/<collection>/album.json describes it:
  {"title", "period" (free text, e.g. "שנות ה-60"), "year_sort" (number, for ordering), "description",
   "contributor", "approved": true|false, "items": {"<file>": {"caption", "year"}}}
Only approved collections are published. Images are resized (web 1600px, thumb 480px); PDFs are rendered
to an image of page 1 and linked. Output: data/archive.json.
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARC = ROOT / "archive"
DATA = ROOT / "data" / "archive.json"
IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
WEB_MAX, THUMB = 1600, 480


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
        items = []
        for f in sorted(x for x in folder.iterdir() if x.is_file() and (x.suffix.lower() in IMG_EXTS or x.suffix.lower() == ".pdf")):
            w_out, t_out = web / (f.stem + ".jpg"), thumb / (f.stem + ".jpg")
            stale = not w_out.exists() or w_out.stat().st_mtime < f.stat().st_mtime
            if stale:
                if f.suffix.lower() == ".pdf":
                    import pymupdf
                    page = pymupdf.open(str(f))[0]
                    zoom = WEB_MAX / page.rect.width
                    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
                    im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                else:
                    im = ImageOps.exif_transpose(Image.open(f)).convert("RGB")
                    im.thumbnail((WEB_MAX, WEB_MAX), Image.LANCZOS)
                im.save(w_out, quality=84, optimize=True, progressive=True)
                ImageOps.fit(im, (THUMB, THUMB), Image.LANCZOS, centering=(0.5, 0.4)).save(t_out, quality=80, optimize=True)
                print(f"rendered {folder.name}/{f.name}")
            m = items_meta.get(f.name, {})
            items.append({
                "web": f"archive/{folder.name}/web/{w_out.name}",
                "thumb": f"archive/{folder.name}/thumb/{t_out.name}",
                "file": f"archive/{folder.name}/{f.name}" if f.suffix.lower() == ".pdf" else "",
                "caption": m.get("caption", ""),
                "year": m.get("year", ""),
                "kind": "document" if f.suffix.lower() == ".pdf" else "photo",
            })
        keep = {Path(i["web"]).name for i in items}
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
