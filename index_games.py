#!/usr/bin/env python3
"""Build data/index.json: the list of stored games that the web UI offers in its drop-down.

Usage:
    uv run index_games.py [--data-dir data]

fetch_pbp.py calls this after every successful download, so it only needs running by hand
after adding or removing files in the data directory yourself.
"""
import argparse
import json
import sys
from pathlib import Path

INDEX_NAME = "index.json"


def _team(t: dict) -> dict:
    return {
        "tricode": t.get("teamTricode"),
        "city": t.get("teamCity"),
        "name": t.get("teamName"),
        "score": t.get("score"),
    }


def entry_for(path: Path) -> dict:
    game = json.loads(path.read_text(encoding="utf-8"))["props"]["pageProps"]["game"]
    return {
        "slug": path.stem,
        "file": path.name,
        "gameId": game.get("gameId"),
        "gameEt": game.get("gameEt"),
        "status": game.get("gameStatusText"),
        "label": " ".join(filter(None, [game.get("gameLabel"), game.get("gameSubLabel")])),
        "home": _team(game["homeTeam"]),
        "away": _team(game["awayTeam"]),
    }


def build_index(data_dir: Path) -> Path:
    entries = []
    for path in sorted(data_dir.glob("*.json")):
        if path.name == INDEX_NAME:
            continue
        try:
            entries.append(entry_for(path))
        except (KeyError, ValueError) as e:
            print(f"warning: skipping {path.name}: {e!r}", file=sys.stderr)
    # Newest game first.
    entries.sort(key=lambda e: (e["gameEt"] or "", e["slug"]), reverse=True)
    out = data_dir / INDEX_NAME
    out.write_text(json.dumps({"games": entries}, indent=2) + "\n", encoding="utf-8")
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--data-dir", default="data", help="directory of stored games (default: data)")
    args = ap.parse_args(argv)
    out = build_index(Path(args.data_dir))
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
