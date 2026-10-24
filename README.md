# play-by-play-wnba

Tools for extracting play-by-play data from WNBA games on [wnba.com](https://www.wnba.com).

The goal is to turn each game into immutable records containing the scoreboard time, the score after the action, whether it was a team or player action, and for player actions the player name and action. At the moment the project covers the first step: capturing the raw play-by-play JSON for a game, exactly as the site publishes it.

## Requirements

- [uv](https://docs.astral.sh/uv/)
- Python 3.14 (uv installs it for you; pinned in `.python-version`)
- No third-party packages (standard library only)
- Internet access to wnba.com

## Setup

```bash
uv sync   # creates .venv with Python 3.14
```

The virtual environment lives in `.venv/`, which is excluded from git.

## Usage

Pass the URL of a game's play-by-play page:

```bash
uv run fetch_pbp.py https://www.wnba.com/game/gsv-vs-atl-1042600303/play-by-play
```

Output:

```
wrote data/gsv-vs-atl-1042600303.json (538,987 bytes)
```

The file is named after the game slug in the URL (the part after `/game/`), and is saved in the `data/` directory, which is created if needed.

### Options

| Option | Description |
|---|---|
| `--out-dir DIR` | Write to `DIR` instead of `data/` |
| `--force` | Overwrite the file if it already exists |

By default an existing file is never overwritten, so a stored game stays unchanged. Re-running for the same game prints an error and exits with code 1 unless you pass `--force`.

### Errors

The script exits with code 1 and prints a message to stderr if:

- the URL is not a wnba.com game page
- the output file already exists (and `--force` was not given)
- the page cannot be downloaded
- the page has no play-by-play actions, for example a game that has not started yet

## What gets stored

wnba.com pages are built with Next.js, and all the page data is embedded in a `<script id="__NEXT_DATA__">` tag. The script saves that JSON pretty-printed (2-space indent), so the file is easy to read and diff. Keys, key order and values are exactly as published; only the whitespace differs. It also checks that play-by-play data is present.

Reading the plays from a stored file:

```python
import json

with open("data/gsv-vs-atl-1042600303.json") as f:
    data = json.load(f)

actions = data["props"]["pageProps"]["playByPlay"]["actions"]
print(len(actions), actions[0]["description"])
```

## Data schema

This section describes the stored file, using `data/gsv-vs-atl-1042600303.json` (Atlanta Dream 97, Golden State Valkyries 71, WNBA Finals Game 3) as the reference. Only the parts that matter for play-by-play are covered. Counts are for that game.

### Where things are

The file is the page's Next.js payload. Almost all of it is site chrome (header, footer, ads, translations, analytics). Two objects under `props.pageProps` matter:

| Path | What it is |
|---|---|
| `props.pageProps.playByPlay.actions` | The play-by-play: a list of 447 action objects, one per row on the page |
| `props.pageProps.game` | Game metadata: teams, rosters, officials, arena, final stats |

Everything else at the top level (`page`, `query`, `buildId`, `locale`, ...) is routing information. `query.props` repeats the URL parts: `["gsv-vs-atl-1042600303", "play-by-play"]`.

### `playByPlay`

| Key | Meaning |
|---|---|
| `gameId` | `"1042600303"`, same as the number at the end of the URL slug |
| `source` | Name of the upstream feed (`"hanaV3"`) |
| `videoAvailable` | 1 if video clips exist for the game |
| `actions` | The list of plays, in game order |

### `game`

| Key | Meaning |
|---|---|
| `gameId`, `gameCode` | `"1042600303"`, `"20261021/GSVATL"` (date and away/home tricodes) |
| `gameStatus`, `gameStatusText`, `period` | `3`, `"Final"`, `4` |
| `gameTimeUTC`, `gameEt` | Scheduled tip-off |
| `homeTeamId`, `awayTeamId` | Team IDs. **Home is Atlanta (`1611661330`), away is Golden State (`1611661331`)**, even though the URL reads `gsv-vs-atl` |
| `homeTeam`, `awayTeam` | `teamId`, `teamName`, `teamCity`, `teamTricode`, final `score`, `timeoutsRemaining`, and a `statistics` object with the team box score |
| `homeTeamPlayers`, `awayTeamPlayers` | Rosters (12 each): `personId`, `name` (full), `nameI` (initial and surname), `firstName`, `familyName` |
| `officials` | Referees: `personId`, `name`, `assignment` |
| `arena`, `attendance`, `duration` | Venue and game length |
| `seriesGameNumber`, `seriesText`, `gameLabel` | Series context ("Game 3", "ATL leads 2-1", "WNBA Finals") |

The rosters are the only place where a full player name appears. Actions carry only the surname or an initial and surname, so join on `personId` to get the full name.

### An action

Every action has exactly these 23 keys, whatever its type. Fields that do not apply are empty (`""`) or `0`.

| Key | Meaning |
|---|---|
| `actionId` | Sequence number, 1 to 447, with no gaps. **This is the ordering key.** |
| `actionNumber` | The league feed's own number (2 to 629). It has gaps and is not in order in the list (some plays are inserted late), so do not sort by it |
| `period` | Quarter, 1 to 4 (there was no overtime) |
| `clock` | Time **remaining** in the period, as an ISO 8601 duration: `PT09M26.00S` is 9:26.00. A period starts at `PT10M00.00S` and ends at `PT00M00.00S`. Tenths of a second occur (`PT00M05.60S`) |
| `scoreHome`, `scoreAway` | Score after the action, as **strings**. Empty on most rows (see below) |
| `pointsTotal` | Home plus away score, as a number, whenever the scores are filled in, otherwise `0` |
| `teamId` | Team that performed the action. **`0` on team, official and period rows** (see below) |
| `teamTricode` | `"ATL"` or `"GSV"` for player rows, empty otherwise |
| `personId` | Who the action belongs to. Usually a player, but it can be a team ID, `0`, or a non-player (see below) |
| `playerName`, `playerNameI` | Surname (`"Reese"`) and initial plus surname (`"A. Reese"`). Empty for team rows |
| `location` | `"h"` for the home team, `"v"` for the visitor, `""` when neither applies |
| `actionType`, `subType` | The kind of action and a refinement of it |
| `description` | The text shown on the page. It carries details that have no field of their own: running player totals, assists, who came in for a substitution |
| `isFieldGoal`, `shotResult`, `shotValue`, `shotDistance`, `xLegacy`, `yLegacy` | Shot details. Only meaningful on made and missed shots |
| `videoAvailable` | 1 if there is a video clip for this action |

### How an action maps to your four requirements

| You want | Where it comes from |
|---|---|
| **Time of action** | `period` and `clock`, the time shown on the scoreboard. Convert `PT09M26.00S` to `9:26` (or to seconds remaining, 566) |
| **Score after the action** | `scoreHome` and `scoreAway` **if filled in**. Otherwise it is the score of the most recent earlier action that had one (carry it forward). Home and away are fixed by `game.homeTeamId`, not by the URL |
| **Team action or player action** | Look at `personId` (see the next section) |
| **Player name and action** | `personId` identifies the player (`playerName`/`playerNameI` for the name, or the roster for the full name). The action is `actionType` plus `subType`, with the details in `description` |

#### Worked example

`actionId` 11, the first basket of the game (abridged):

```json
{
  "actionId": 11, "period": 1, "clock": "PT08M43.00S",
  "scoreHome": "2", "scoreAway": "0", "pointsTotal": 2,
  "teamId": 1611661330, "teamTricode": "ATL", "location": "h",
  "personId": 1642291, "playerName": "Reese", "playerNameI": "A. Reese",
  "actionType": "Made Shot", "subType": "Layup Shot",
  "shotResult": "Made", "isFieldGoal": 1, "shotValue": 2, "shotDistance": 2,
  "description": "Reese 2' Layup (2 PTS) (Howard 1 AST)"
}
```

This is: at 8:43 of the 1st quarter, Atlanta's A. Reese (a player action) makes a 2-point layup from 2 feet, assisted by Howard, and the score becomes 2-0 (home-away).

### Team action or player action

`personId` takes four kinds of value, and this is how to tell them apart:

| `personId` is... | Meaning | `teamId` | Rows (this game) |
|---|---|---|---|
| a player ID found in `homeTeamPlayers`/`awayTeamPlayers` | **Player action** | the player's team | 400 |
| `homeTeamId` or `awayTeamId` | **Team action** (the team is the actor) | `0` | 36: 24 team rebounds, 8 timeouts, 4 team turnovers |
| `0` | **Game action**, belonging to neither team | `0` | 9: 8 period start/end rows and 1 official timeout |
| anything else | **Non-player person** | `0` | 2: a technical foul on a coach (`201089`, Natalie Nakase) and an instant replay review (`262`) |

Pitfalls:

- **`teamId` and `teamTricode` are empty for team actions.** The team is in `personId`. Use `location` (`"h"`/`"v"`) as a cross-check.
- **`subType` does not reliably identify team rebounds.** Both team and player rebounds can be `"Unknown"`. Use `personId`.
- **`actionType` is empty on 24 rows**: the blocks and steals (see below).
- The two non-player rows have an empty `playerNameI` (the coach) or a name that is not on either roster (the replay row, `"M. Cage"`). Treat them as game or staff events, not player actions.

### Action types

All 447 actions, grouped by `actionType`:

| `actionType` | Rows | Who it belongs to | `subType` | `description` format |
|---|---|---|---|---|
| `Made Shot` | 58 | Shooter | Shot style: `Layup Shot`, `Jump Shot`, `Driving Layup Shot`, `Pullup Jump shot`, ... | `Reese 2' Layup (2 PTS) (Howard 1 AST)`: distance, style, shooter's running points, assister and assist count (if assisted). Threes read `24' 3PT Jump Shot` |
| `Missed Shot` | 80 | Shooter | Same as above | `MISS Howard 2' Cutting Layup Shot` |
| `Free Throw` | 46 | Shooter | `Free Throw 1 of 2`, `2 of 2`, `1 of 1`, `Technical` | Made: `Gray Free Throw 1 of 2 (1 PTS)`. Missed: `MISS Charles Free Throw 1 of 2` |
| `Rebound` | 95 | A player (71) or a team (24) | `Unknown` or `Normal Rebound` (not reliable) | Player: `Thornton REBOUND (Off:0 Def:1)`, with running offensive and defensive counts. Team: `Valkyries Rebound` |
| `Turnover` | 27 | A player (23) or a team (4) | The kind: `Bad Pass`, `Lost Ball`, `Traveling`, `Shot Clock Turnover`, ... | Player: `Burton Step Out of Bounds Turnover (P1.T1)`. Team: `Valkyries Turnover: Shot Clock (T#3)` |
| `Foul` | 40 | The player who committed it (39) or a coach (1) | `Shooting`, `Personal`, `Offensive`, `Loose Ball`, `Technical`, ... | `Stokes S.FOUL (P1.T1)`: player foul count, then team foul count |
| `Substitution` | 54 | The player **going out** | none | `SUB: Hayes FOR Zandalasini`: **in** FOR **out**. The player coming in appears only here, by surname |
| `Timeout` | 9 | A team (8) or nobody (1) | `Regular`, `Reset`, `Official` | `Valkyries Timeout: Regular (Reg.1 Short 0)` |
| `Jump Ball` | 5 | One of the two jumpers | none | `Jump Ball Reese vs. Stokes: Tip to Hillmon` |
| `period` | 8 | Nobody | `start`, `end` | `Start of 1st Period (8:12 PM EST)`: the time in brackets is real clock time |
| `Instant Replay` | 1 | A non-player | `Coach Challenge Support Ruling` | `Instant Replay2nd Period (8:56 PM EST)` |
| *(empty)* | 24 | The player credited | none | `Burton BLOCK (1 BLK)` or `Reese STEAL (1 STL)`, with the running total |

Notes:

- **Blocks and steals are their own rows**, separate from the miss or turnover they caused. They are credited to the defender, so `actionType` is empty and the only way to classify them is the word `BLOCK` or `STEAL` in `description`. They carry `shotValue` 2 on blocks, which is not a score.
- **The numbers in brackets are running totals** for the player or team at that moment (points, assists, rebounds, fouls, turnovers, blocks, steals), not values for the single action.
- **Names in `description` are surnames and are not unique IDs.** Use `personId`.
- Team names in descriptions are written inconsistently (`Valkyries`, `DREAM`).

### Score fields

`scoreHome` and `scoreAway` are filled in on only 98 of 447 rows:

| Rows with a score | Count |
|---|---|
| `Made Shot` | 58 |
| `Free Throw` that went in | 31 (the 15 misses are blank) |
| `period` start and end | 8 |
| `Instant Replay` | 1 |

On every other row (the 349 others) they are empty strings. So the score after a rebound, foul or substitution is the last score seen before it. The first row of the game (`Start of 1st Period`) has `"0"` and `"0"`, so carrying forward always has a starting value.

The score is the score **after** the action. I checked that on every made shot and made free throw, the total rises by exactly `shotValue` (2 or 3) or 1.

Scores are strings (`"23"`), while `pointsTotal` is a number.

### Order and time

- Use `actionId` (equivalently, the position in the list) as the order. Within a period, `clock` never increases along the list.
- Many actions share the same `clock` value, for example the two free throws of a trip, so the clock alone does not give an order.
- Each period is 10 minutes (`PT10M00.00S` down to `PT00M00.00S`). The file has 126, 100, 107 and 114 actions in periods 1 to 4.

### Shot fields

`isFieldGoal`, `shotResult` (`"Made"` or `"Missed"`), `shotValue` (2 or 3), `shotDistance` (feet) and the court coordinates `xLegacy`/`yLegacy` are filled in only on `Made Shot` and `Missed Shot`. On other rows they are `0` or empty. Free throws have `isFieldGoal` 0 and `shotValue` 0.

## Web interface

A static page (plain HTML and ES modules, no build step, no dependencies) with two tabs for any stored game. It opens on **Lead tracker**; the other tab is **Player stats**.

```bash
uv run python -m http.server 8000
# then open http://localhost:8000/web/
```

It has to be served over HTTP because it loads the JSON with `fetch`; opening `web/index.html` directly from disk will not work.

- **Game drop-down**: lists every game in `data/`, highest game number first (the digits at the end of the slug), and the page opens on that first game. The list comes from `data/index.json`, which `fetch_pbp.py` rebuilds after every download. If you add or delete files in `data/` by hand, run `uv run index_games.py`. Choosing a game puts it in the URL (`#slug`), so that choice can be bookmarked and survives a reload; a visit without a `#slug` always opens the highest-numbered game.
### Lead tracker tab

- **Lead tracker**: the home-minus-away score margin over the 40 minutes of the game (5-minute periods are added for overtime). It rises above zero when the home team leads and falls below when the away team does. Hover for the time, score, lead and the most recent scoring play.
- **Highlight runs**: draws a numbered arrow over each run, a stretch where one team scores 7 or more points in a row and the other scores none. The arrow goes from the lead before the run's first score to the lead after its last. Runs can span quarters.
- **Best / worst players in each run** (needs run highlighting on): one card per run with the best and worst player by Game Score and by EFF, plus an expandable table of every player in the run. Hovering a card shades its window on the chart, and hovering an arrow highlights its card.

### Player stats tab

One table per team (home first), listing every player who took part in the game, with: points, field goals, three-pointers and free throws (made-attempted), offensive, defensive and total rebounds, assists, steals, blocks, turnovers, personal fouls, **Game Score** and **EFF**. Game Score and EFF sit right after the player name so they stay visible on narrow screens. Click a column heading to sort (click again to reverse); tables start sorted by Game Score. A "Team" row sums the players. Above the tables, the game's best Game Score and best EFF are called out.

Minutes played are not in the play-by-play data, so there is no minutes column. Players who were on the roster but never appear in any action are not listed.

### Definitions used



- A run's **window** starts right after the opponent's last score and ends with the run's last score. It includes the misses, turnovers, steals and blocks that produced the run, not just the baskets.
- **Game Score** (Hollinger) = PTS + 0.4·FGM − 0.7·FGA − 0.4·(FTA − FTM) + 0.7·OREB + 0.3·DREB + STL + 0.7·AST + 0.7·BLK − 0.4·PF − TOV.
- **EFF** = (PTS + REB + AST + STL + BLK) − (missed FG + missed FT + TOV).
- In the run cards, only players with at least one recorded action in the window are ranked (the stats tab lists everyone who took part in the game), since the data does not say who was on the court. Players tied for best or worst are all listed.
- Stats are derived from the play descriptions (for example, an assist is read from `(Howard 1 AST)`). Team rebounds and team turnovers belong to no player and are not counted.

### Tests

```bash
node --test tests/
```

These need Node 22 or newer, and run the logic in `web/model.js` against every game in `data/`. They check, for example, that the final score matches the published score and that the stats derived from the plays add up to the published team box score (points, FG, 3P, FT, assists, steals, blocks and personal fouls match exactly).

## Hosting on GitHub Pages

The viewer is static, so it can be published as-is. `.github/workflows/pages.yml` builds a small site from `web/`, `data/` and a root `index.html` (which redirects to `web/`) and deploys it to GitHub Pages. The site ends up at `https://<user>.github.io/<repo>/`.

One-time setup:

1. Make the repository public. Pages on a free GitHub account needs that, and the workflow skips its job (it does not fail) while the repo is private. Note that this publishes everything in `data/`, which is the full page payload that wnba.com sends, not just the plays.
2. Go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main` (or run the workflow from the **Actions** tab). Later pushes redeploy automatically, so adding a game is: `uv run fetch_pbp.py <url>`, commit `data/`, push.

If your account is on a plan that allows private Pages, change or remove the `if:` line in the workflow.

### Adding a game from GitHub

The **Add game** workflow (`.github/workflows/add-game.yml`) fetches a game on GitHub's servers and commits it to `data/`, so you don't need your laptop. Give it the game slug, which is the part of the URL after `/game/`:

```bash
gh workflow run add-game.yml -f slug=gsv-vs-atl-1042600303
```

or use **Actions → Add game → Run workflow** on GitHub. It fetches the page, runs the model tests, commits `data/<slug>.json` and the updated `data/index.json` to `main`, and starts the Pages deploy, so the new game appears in the drop-down a minute or so later.

Options: If the game is already in `data/`, the run ends early as a skipped, successful run and changes nothing; `force=true` overwrites it instead, and `dry_run=true` fetches and tests without committing or deploying. A failing test is reported in the run summary but does not stop the commit. The data comes from wnba.com, which may block GitHub's servers in future; if the fetch step fails, run `fetch_pbp.py` locally instead.

## Project layout

```
pyproject.toml uv project config (Python 3.14, no dependencies)
fetch_pbp.py   downloads a game page and stores its JSON
index_games.py builds data/index.json (the web drop-down's game list)
data/          stored game files, one per game, plus index.json
web/           static lead tracker page
  model.js     pure game logic: scores, runs, player stats (no DOM)
  chart.js     SVG lead tracker
  statsView.js Player stats tab (sortable tables)
  app.js       page wiring: drop-down, tabs, checkboxes, run cards
tests/         Node tests for web/model.js
index.html     redirects the site root to web/ (used by GitHub Pages)
.github/workflows/pages.yml     deploys web/ and data/ to GitHub Pages
.github/workflows/add-game.yml  fetches a game by slug and commits it to data/
CLAUDE.md      guidance for Claude Code
```

## Status

The web interface is working. Exporting the plays as standalone immutable records (outside the browser) is not implemented yet.
