#!/usr/bin/env python3
"""Photo gallery: every folder under gallery/ is an album.

Originals go in gallery/<album>/ (JPG/PNG/WebP/HEIC-converted). This script writes
gallery/<album>/web/<name>.jpg (max 1600px, quality 82) and gallery/<album>/thumb/<name>.jpg
(480px square-ish crop), and lists everything in data/gallery.json.
Album title = folder name with dashes as spaces (a title already in gallery.json is kept).
Album date = date the folder first appeared in git (or an "album.json" {"title","date","cover","description","when"} in the folder;
"when" is free text shown instead of the date, e.g. "מוצאי שבת פרשת נח, לאורך השנים").
Delete a folder to remove an album.
"""
import json, re, subprocess, sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GAL = ROOT / "gallery"
DATA = ROOT / "data" / "gallery.json"
EXTS = {".jpg", ".jpeg", ".png", ".webp"}
WEB_MAX, THUMB = 1600, 480


def first_commit_date(p):
    out = subprocess.run(["git", "log", "--diff-filter=A", "--format=%cs", "--", str(p)],
                         capture_output=True, text=True, cwd=ROOT).stdout.strip().splitlines()
    return out[-1] if out else date.today().isoformat()


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    from PIL import Image, ImageOps
    old = {}
    if DATA.exists():
        old = {a["slug"]: a for a in json.loads(DATA.read_text(encoding="utf-8")).get("albums", [])}
    albums = []
    for folder in sorted(p for p in GAL.iterdir() if p.is_dir() and not p.name.startswith(".")):
        originals = sorted(f for f in folder.iterdir() if f.is_file() and f.suffix.lower() in EXTS)
        if not originals:
            continue
        web, thumb = folder / "web", folder / "thumb"
        web.mkdir(exist_ok=True); thumb.mkdir(exist_ok=True)
        photos = []
        for f in originals:
            w_out, t_out = web / (f.stem + ".jpg"), thumb / (f.stem + ".jpg")
            if not w_out.exists() or w_out.stat().st_mtime < f.stat().st_mtime:
                im = ImageOps.exif_transpose(Image.open(f)).convert("RGB")
                im.thumbnail((WEB_MAX, WEB_MAX), Image.LANCZOS)
                im.save(w_out, quality=82, optimize=True, progressive=True)
                t = ImageOps.fit(im, (THUMB, THUMB), Image.LANCZOS, centering=(0.5, 0.4))
                t.save(t_out, quality=80, optimize=True)
                print(f"rendered {folder.name}/{f.name} -> {im.size[0]}x{im.size[1]}")
            photos.append({"web": f"gallery/{folder.name}/web/{w_out.name}", "thumb": f"gallery/{folder.name}/thumb/{t_out.name}"})
        # stale renders
        keep = {p["web"].rsplit("/", 1)[1] for p in photos}
        for d in (web, thumb):
            for s in d.glob("*.jpg"):
                if s.name not in keep:
                    s.unlink()
        meta = {}
        mf = folder / "album.json"
        if mf.exists():
            try: meta = json.loads(mf.read_text(encoding="utf-8"))
            except Exception: meta = {}
        prev = old.get(folder.name, {})
        title = meta.get("title") or prev.get("title") or re.sub(r"[-_]+", " ", folder.name).strip()
        albums.append({
            "slug": folder.name,
            "title": title,
            "date": meta.get("date") or prev.get("date") or first_commit_date(folder),
            "cover": meta.get("cover") or prev.get("cover") or (photos[0]["thumb"] if photos else ""),
            "description": meta.get("description", prev.get("description", "")),
            "when": meta.get("when", prev.get("when", "")),
            "count": len(photos),
            "photos": photos,
        })
    albums.sort(key=lambda a: a["date"], reverse=True)
    DATA.write_text(json.dumps({"albums": albums}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"gallery.json: {len(albums)} album(s), {sum(a['count'] for a in albums)} photo(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
