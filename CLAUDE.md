# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

The app is called **WNBA Hindsight** (GitHub repo `babak4/WNBA-Hindsight`, live at https://babak4.github.io/WNBA-Hindsight/; the local folder is still named `play-by-play-wnba`). Use that name for anything user-facing; "play-by-play" remains correct when it describes the data or wnba.com's `/play-by-play` URLs.

Extract basketball play-by-play data (WNBA first) into immutable records: scoreboard time, score after the action, a team-vs-player flag, and for player actions the player name and action. The raw-capture stage (Python) and a static web viewer (JavaScript) exist; exporting standalone records is not built yet.

## Commands

Managed with uv on Python 3.14 (`.python-version`); the venv is `.venv/` (gitignored). Run `uv sync` once to create it. No dependencies (standard library only), no lint or test setup yet.

```bash
uv run fetch_pbp.py https://www.wnba.com/game/gsv-vs-atl-1042600303/play-by-play   # writes data/gsv-vs-atl-1042600303.json
uv run fetch_pbp.py <url> --out-dir <dir>   # alternate output directory
uv run fetch_pbp.py <url> --force           # overwrite an existing file (refused by default)
uv run index_games.py                       # rebuild data/index.json (fetch_pbp.py does this automatically)
uv run python -m http.server 8000           # serve the repo, then open http://localhost:8000/web/
node --test tests/                          # model tests (Node 22+); `node --test --test-name-pattern=<text> tests/` for one
```

## Architecture

- `fetch_pbp.py` downloads a wnba.com game page and stores the JSON from its `<script id="__NEXT_DATA__">` tag, pretty-printed (indent 2, key order and values unchanged), as `data/<slug>.json`, where `<slug>` is the `/game/<slug>/` segment of the URL. Content must stay identical to the page's JSON (formatting is the only change): `data/` is the immutable raw layer, and existing files are never overwritten without `--force`.
- `data/index.json` is the manifest the web drop-down reads (a static page cannot list a directory). It is generated, never hand-edited.
- `web/` is a static ES-module app with no build step. Keep game logic in `web/model.js` (no DOM; this is what `tests/model.test.js` covers) and rendering in `chart.js` (lead tracker), `statsView.js` (player stats tab) and `app.js` (drop-down, tabs, run cards). The page has two tabs; the lead tracker must stay the default. Colors live in CSS custom properties in `web/style.css` (light tokens on `:root`, dark on `:root[data-theme="dark"]`); SVG and components must use the tokens so the **Dark theme** checkbox (`theme.js`, with an inline pre-paint script in `index.html`) restyles everything without a redraw. The tests check derived player stats against the published team box score, so a parsing change that breaks stat totals fails loudly. Run `buildGame` -> `findRuns` -> `runReport` for the data flow. Run windows start after the opponent's last score and end at the run's last score. The run size is user-set (default `RUN_MIN_POINTS` = 7, allowed 3-40 via `clampRunSize`); the input rules are pure functions in `web/runInput.js` (tested), and `app.js` only wires them to the box. Never hardcode 7: use `runSize`/`[data-run-size]`. Team timeouts for the chart come from `timeouts()` (regular timeouts and coach challenges; official timeouts and "Reset" rows are deliberately excluded). A period picked by dragging on the chart goes through `selectionSummary`/`eventRange`, which use the half-open range (from, to] so adjacent periods never share an event; a test checks that the quarters add up to the whole game.
- GitHub Pages: `.github/workflows/pages.yml` publishes `web/` + `data/` (+ the root redirect `index.html`) and only runs when the repo is public. The app's relative `../data/` paths depend on `web/` and `data/` staying siblings.
- `.github/workflows/add-game.yml` (manual, input `slug`) runs `fetch_pbp.py` in CI, commits `data/` to `main`, then dispatches `pages.yml` explicitly (pushes made with `GITHUB_TOKEN` do not trigger other workflows). Pass inputs through `env:`, never interpolate them into `run:` scripts.
- Data comes from that embedded JSON, not from scraping rendered HTML. Plays are at `props.pageProps.playByPlay.actions`; team identity (home/away) is in `props.pageProps.game` (`homeTeamId`, `awayTeamId`).

## Data quirks to handle when building the parser

Verified against game 1042600303 (full schema in `README.md`); check other games before relying on them.

- `scoreHome`/`scoreAway` are strings, empty on 349 of 447 rows (only made shots, made free throws, period markers and the replay row carry them), so the score after an action must be forward-filled.
- `clock` is an ISO duration (`PT09M26.00S`, time remaining in the period) and can have tenths of a second.
- Team vs player is decided by `personId`: a roster player ID means a player action; `homeTeamId`/`awayTeamId` means a team action (team rebounds, timeouts, turnovers) and then `teamId` and `teamTricode` are empty; `0` means a game row (period start/end, official timeout); anything else is a non-player (a coach's technical foul, the instant replay row).
- Blocks and steals have an empty `actionType`; classify them from `description` ("X BLOCK", "X STEAL").
- Substitutions are one row ("SUB: A FOR B") attributed to the outgoing player; the incoming player is only in `description`, by surname.
- Order by `actionId` (list order). `actionNumber` has gaps and is not monotonic in the list.
- Home/away must come from `game.homeTeamId`, not the URL slug order (in the sample, "gsv-vs-atl" has ATL at home).
- Full player names exist only in `game.homeTeamPlayers`/`awayTeamPlayers`; actions carry surnames.
