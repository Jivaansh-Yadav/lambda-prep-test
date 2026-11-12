#!/usr/bin/env python3
"""
Download the whole ISC Class XII community archive from class-12-isc.vercel.app
into plain folders on your disk, keeping the site's own subject/category order.

    ./isc12-archive.py                      # everything -> ./ISC-Class12
    ./isc12-archive.py -o ~/Downloads/ISC   # somewhere else
    ./isc12-archive.py -j 4                 # 4 parallel downloads (default 3)
    ./isc12-archive.py --subject Physics    # one subject only
    ./isc12-archive.py --limit 5            # smoke test
    ./isc12-archive.py --list               # just print what would be fetched

Layout produced:

    ISC-Class12/
      Accounts/
        Chapter 1 - Fundamentals/
          01 - Fundamentals_Accountancy_Percentage Booster.pdf
          _order.txt
      Economics/
        ...

Files are numbered inside their category so the folder lists them in the same
order the site does. Re-running is safe and cheap: finished files are skipped,
half-downloaded files resume from where they stopped.

Only the Python standard library is used; the only external tools needed are
python3 (already on Linux Mint) and a network connection. Files stream straight
from the original Google Drive copies — the site is only the index.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import re
import shutil
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

SITE = "https://class-12-isc.vercel.app"
DATA_URL = f"{SITE}/notes-data.js"
DRIVE = "https://drive.usercontent.google.com/download"
UA = "Mozilla/5.0 (X11; Linux x86_64) isc12-archive/1.0"

ILLEGAL = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
BAD_TAIL = re.compile(r'[. ]+$')


# --------------------------------------------------------------------- manifest


def load_manifest(data_path: Path | None) -> list[dict]:
    """Site order = source order. Prefer a local snapshot, else fetch the site."""
    text = None
    if data_path:
        text = data_path.read_text(encoding="utf-8")
    else:
        try:
            print(f"· reading index from {DATA_URL}")
            req = urllib.request.Request(DATA_URL, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                text = r.read().decode("utf-8", "replace")
        except Exception as exc:  # offline / site moved
            raise SystemExit(
                f"Could not read the index from {DATA_URL} ({exc}).\n"
                "Pass --data /path/to/notes-data.js or notes-data.json to work offline."
            )

    text = text.strip()
    if text.startswith("{"):
        return json.loads(text)

    m = re.search(r"window\.__FALLBACK_NOTES_DATA__\s*=\s*(\[.*\])\s*;?\s*$", text, re.S)
    if not m:
        raise SystemExit("index format not recognised — expected window.__FALLBACK_NOTES_DATA__ = [...]")
    return json.loads(m.group(1))


def safe(name: str, limit: int = 170) -> str:
    cleaned = ILLEGAL.sub("-", name).strip()
    cleaned = BAD_TAIL.sub("", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return cleaned[:limit] or "untitled"


def drive_id(entry: dict) -> str | None:
    if entry.get("driveId"):
        return entry["driveId"]
    blob = f"{entry.get('url', '')} {entry.get('downloadUrl', '')} {entry.get('previewUrl', '')}"
    m = re.search(r"(?:/d/|id=)([A-Za-z0-9_-]{20,})", blob)
    return m.group(1) if m else None


# -------------------------------------------------------------------- download


def already_ok(path: Path) -> bool:
    try:
        return path.is_file() and path.stat().st_size > 1024
    except OSError:
        return False


def looks_like_html(path: Path) -> bool:
    try:
        with path.open("rb") as f:
            head = f.read(512).lstrip().lower()
        return head.startswith(b"<!doctype html") or head.startswith(b"<html")
    except OSError:
        return False


def fetch(fid: str, dest: Path, retries: int = 4, force: bool = False) -> tuple[str, str]:
    """Download one Drive file. Returns (status, message)."""
    if already_ok(dest) and not force:
        return "skip", "already downloaded"

    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")

    for attempt in range(1, retries + 1):
        have = part.stat().st_size if part.exists() else 0
        if have and not force:
            part.unlink()  # Drive rarely honours Range on these URLs; restart cleanly.
            have = 0
        url = f"{DRIVE}?id={fid}&export=download&confirm=t&uuid={random.getrandbits(32):08x}"
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                ctype = (resp.headers.get("Content-Type") or "").lower()
                if "text/html" in ctype:
                    raise IOError("Drive returned an HTML page (quota, permission, or removed file)")
                total = int(resp.headers.get("Content-Length") or 0)
                written = 0
                with part.open("wb") as out:
                    while True:
                        chunk = resp.read(1 << 20)
                        if not chunk:
                            break
                        out.write(chunk)
                        written += len(chunk)
                if total and written != total:
                    raise IOError(f"short read ({written} of {total} bytes)")
            if looks_like_html(part):
                raise IOError("saved an HTML error page instead of the file")
            part.replace(dest)
            return "ok", f"{written / 1048576:.1f} MB"
        except urllib.error.HTTPError as exc:
            msg = f"HTTP {exc.code}"
            if exc.code in (400, 404):  # gone or never existed — retrying won't help
                part.unlink(missing_ok=True)
                return "fail", msg
        except Exception as exc:  # noqa: BLE001 - network layer, message only
            msg = str(exc) or exc.__class__.__name__
        if attempt < retries:
            wait = min(2 ** attempt, 30) * (1 + random.random() / 2)
            time.sleep(wait)
    if part.exists():
        part.unlink(missing_ok=True)
    return "fail", msg


# ------------------------------------------------------------------------ main


def main() -> int:
    ap = argparse.ArgumentParser(description="Download the ISC Class XII community archive by subject/category.")
    ap.add_argument("-o", "--out", default="ISC-Class12", help="output folder (default: ./ISC-Class12)")
    ap.add_argument("-j", "--jobs", type=int, default=3, help="parallel downloads (default 3)")
    ap.add_argument("--subject", action="append", help="limit to a subject (repeatable, e.g. --subject Physics)")
    ap.add_argument("--limit", type=int, help="stop after N files (smoke test)")
    ap.add_argument("--data", type=Path, help="local notes-data.js / .json instead of fetching the site")
    ap.add_argument("--list", action="store_true", help="print the tree and exit")
    ap.add_argument("--force", action="store_true", help="re-download files that already exist")
    ap.add_argument("--flat", action="store_true", help="drop the numbering prefix from filenames")
    args = ap.parse_args()

    entries = load_manifest(args.data)
    if args.subject:
        wanted = {s.lower() for s in args.subject}
        entries = [e for e in entries if (e.get("subject") or "").lower() in wanted]
        if not entries:
            raise SystemExit(f"no files for: {', '.join(args.subject)}")
    if args.limit:
        entries = entries[: args.limit]

    # Group in site order: subjects in first-seen order, categories likewise.
    order: dict[str, dict[str, list[dict]]] = {}
    for e in entries:
        subject = e.get("subject") or "Miscellaneous"
        category = e.get("category") or "Unsorted"
        order.setdefault(subject, {}).setdefault(category, []).append(e)

    root = Path(os.path.expanduser(args.out)).resolve()
    plan: list[tuple[dict, Path]] = []
    for subject, cats in order.items():
        for category, items in cats.items():
            for idx, entry in enumerate(items, start=1):
                name = entry.get("fullFileName") or f"{entry.get('title', 'file')}.{entry.get('fileType', 'pdf').lower()}"
                prefix = "" if args.flat else f"{idx:02d} - "
                plan.append((entry, root / safe(subject, 60) / safe(category, 80) / (prefix + safe(name, 150))))

    print(f"· {len(plan)} files across {len(order)} subjects -> {root}")
    if args.list:
        for subject, cats in order.items():
            print(f"\n{subject}")
            for category, items in cats.items():
                print(f"  {category}  ({len(items)} files)")
        return 0

    root.mkdir(parents=True, exist_ok=True)
    total = len(plan)
    lock = threading.Lock()
    stats = {"ok": 0, "skip": 0, "fail": 0}
    failures: list[tuple[str, str, str]] = []
    started = time.time()

    def work(job):
        entry, dest = job
        fid = drive_id(entry)
        label = f"{entry.get('subject')}/{entry.get('category')}/{dest.name}"
        if not fid:
            return entry, dest, "fail", "no Drive id in the index"
        status, msg = fetch(fid, dest, force=args.force)
        return entry, dest, status, msg

    with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        futures = [pool.submit(work, job) for job in plan]
        for done, fut in enumerate(as_completed(futures), start=1):
            entry, dest, status, msg = fut.result()
            with lock:
                stats[status] += 1
                if status == "fail":
                    failures.append((entry.get("subject", ""), entry.get("fullFileName", str(dest)), msg))
                    mark = "FAIL"
                elif status == "skip":
                    mark = "skip"
                else:
                    mark = msg
                rel = dest.relative_to(root)
                print(f"[{done:>4}/{total}] {mark:<12} {rel}", flush=True)

    elapsed = time.time() - started
    print(f"\ndone in {elapsed / 60:.1f} min — {stats['ok']} downloaded, {stats['skip']} already there, {stats['fail']} failed")

    report = root / "_manifest.csv"
    with report.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["site_order", "subject", "category", "filename", "drive_id", "site_title", "tag"])
        for i, (entry, dest) in enumerate(plan, start=1):
            w.writerow([
                i,
                entry.get("subject", ""),
                entry.get("category", ""),
                dest.name,
                drive_id(entry) or "",
                entry.get("title", ""),
                entry.get("tag", ""),
            ])
    print(f"manifest: {report}")

    if failures:
        fail_file = root / "_failed.txt"
        with fail_file.open("w", encoding="utf-8") as f:
            for subject, name, msg in failures:
                f.write(f"{subject}\t{name}\t{msg}\n")
        print(f"{len(failures)} failed — see {fail_file}; re-run the same command to retry them")
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nstopped — re-run the same command to carry on", file=sys.stderr)
        sys.exit(130)
