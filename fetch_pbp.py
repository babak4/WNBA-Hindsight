#!/usr/bin/env python3
"""Download a WNBA play-by-play page and store its embedded JSON.

Usage:
    uv run fetch_pbp.py https://www.wnba.com/game/gsv-vs-atl-1042600303/play-by-play
    uv run fetch_pbp.py <url> --out-dir data --force

The page embeds all of its data in <script id="__NEXT_DATA__">. That JSON is
written, pretty-printed (2-space indent, key order and values preserved), to
<out-dir>/<slug>.json, where <slug> is the game slug from the URL
(e.g. "gsv-vs-atl-1042600303").
Existing files are never overwritten unless --force is given.
"""
import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from index_games import build_index

# Desktop Chrome 155 (stable as of 2026-10-13) on macOS. Chrome freezes the OS token at
# "10_15_7" on every macOS version, so this is also what the newest macOS reports.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36"
)
GAME_PATH = re.compile(r"^/game/(?P<slug>[a-z0-9]+(?:-[a-z0-9]+)*-\d+)(?:/|$)", re.I)
NEXT_DATA = re.compile(
    r'<script id="__NEXT_DATA__"[^>]*>(?P<json>.*?)</script>', re.S
)


def game_slug(url: str) -> str:
    parsed = urlparse(url)
    if parsed.hostname not in ("www.wnba.com", "wnba.com"):
        raise ValueError(f"not a wnba.com URL: {url}")
    m = GAME_PATH.match(parsed.path)
    if not m:
        raise ValueError(f"URL has no /game/<slug> path: {url}")
    return m.group("slug")


def fetch_html(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def extract_next_data(html: str) -> dict:
    m = NEXT_DATA.search(html)
    if not m:
        raise ValueError("__NEXT_DATA__ script not found in page")
    data = json.loads(m.group("json"))
    actions = data.get("props", {}).get("pageProps", {}).get("playByPlay", {}).get("actions")
    if not actions:
        raise ValueError("page has no play-by-play actions (game not started yet?)")
    return data


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("url", help="WNBA play-by-play page URL")
    ap.add_argument("--out-dir", default="data", help="output directory (default: data)")
    ap.add_argument("--force", action="store_true", help="overwrite an existing file")
    args = ap.parse_args(argv)

    try:
        slug = game_slug(args.url)
        out = Path(args.out_dir) / f"{slug}.json"
        if out.exists() and not args.force:
            print(f"error: {out} already exists (use --force to overwrite)", file=sys.stderr)
            return 1
        data = extract_next_data(fetch_html(args.url))
    except (ValueError, urllib.error.URLError, json.JSONDecodeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1

    out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    out.write_bytes(text.encode("utf-8"))  # binary write: no newline translation
    print(f"wrote {out} ({len(text.encode('utf-8')):,} bytes)")
    print(f"updated {build_index(out.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
