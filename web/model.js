// Pure game logic: no DOM. Turns a stored play-by-play file into scoring timeline,
// runs, and per-player stats. See README.md ("Data schema") for the field meanings.

export const RUN_MIN_POINTS = 7;

export function parseClock(iso) {
  const m = /^PT(\d+)M([\d.]+)S$/.exec(iso);
  if (!m) throw new Error(`bad clock: ${iso}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export const periodLength = (period) => (period <= 4 ? 600 : 300);

export function elapsedSeconds(period, remaining) {
  let before = 0;
  for (let p = 1; p < period; p++) before += periodLength(p);
  return before + periodLength(period) - remaining;
}

export function formatClock(remaining) {
  const s = Math.round(remaining * 10) / 10;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  const secText = Number.isInteger(sec) ? String(sec).padStart(2, "0") : sec.toFixed(1).padStart(4, "0");
  return `${m}:${secText}`;
}

export const periodName = (p) => (p <= 4 ? `Q${p}` : p === 5 ? "OT" : `${p - 4}OT`);

const blankStats = () => ({
  pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0,
  ast: 0, stl: 0, blk: 0, pf: 0, tov: 0,
});

/**
 * @param {object} raw the parsed contents of a stored data/<slug>.json file
 */
export function buildGame(raw) {
  const pageProps = raw.props.pageProps;
  const game = pageProps.game;
  const actions = pageProps.playByPlay.actions;

  const sideOfTeamId = new Map([
    [game.homeTeamId, "home"],
    [game.awayTeamId, "away"],
  ]);
  const teams = {
    home: { ...game.homeTeam, side: "home" },
    away: { ...game.awayTeam, side: "away" },
  };

  // Players, from the rosters (full names live only there).
  const players = new Map();
  for (const [side, list] of [["home", game.homeTeamPlayers], ["away", game.awayTeamPlayers]]) {
    for (const p of list) players.set(p.personId, { ...p, side });
  }

  // surname used in descriptions -> personId, per side (needed to credit assists)
  const bySurname = { home: new Map(), away: new Map() };
  for (const a of actions) {
    const p = players.get(a.personId);
    if (p && a.playerName) bySurname[p.side].set(a.playerName.toLowerCase(), a.personId);
  }
  for (const p of players.values()) {
    const k = p.familyName.toLowerCase();
    if (!bySurname[p.side].has(k)) bySurname[p.side].set(k, p.personId);
  }

  const ordered = [...actions].sort((a, b) => a.actionId - b.actionId);
  const offCount = new Map(); // personId -> offensive rebounds seen so far (descriptions carry running totals)
  const events = [];
  let home = 0, away = 0;

  for (const a of ordered) {
    const remaining = parseClock(a.clock);
    const person = players.get(a.personId);
    const side = person ? person.side : sideOfTeamId.get(a.personId) ?? null;
    const kind = person ? "player" : sideOfTeamId.has(a.personId) ? "team" : a.personId === 0 ? "game" : "other";

    // Score after this action: carry the last known score forward.
    let scored = null;
    if (a.scoreHome !== "") {
      const h = Number(a.scoreHome), v = Number(a.scoreAway);
      if (h !== home || v !== away) {
        scored = { side: h > home ? "home" : "away", points: h - home + (v - away) };
      }
      home = h;
      away = v;
    }

    // Per-player stat increments contributed by this action.
    const deltas = [];
    const add = (pid, stat, n = 1) => deltas.push({ pid, stat, n });
    if (person) {
      const d = a.description;
      switch (a.actionType) {
        case "Made Shot": {
          add(a.personId, "fgm"); add(a.personId, "fga"); add(a.personId, "pts", a.shotValue);
          if (a.shotValue === 3) { add(a.personId, "tpm"); add(a.personId, "tpa"); }
          const am = /\(([^()]+?) \d+ AST\)/.exec(d);
          if (am) {
            const ast = bySurname[person.side].get(am[1].trim().toLowerCase());
            if (ast) add(ast, "ast");
          }
          break;
        }
        case "Missed Shot":
          add(a.personId, "fga");
          if (a.shotValue === 3) add(a.personId, "tpa");
          break;
        case "Free Throw":
          add(a.personId, "fta");
          if (!/^MISS /.test(d)) { add(a.personId, "ftm"); add(a.personId, "pts"); }
          break;
        case "Rebound": {
          const rm = /Off:(\d+)/.exec(d);
          if (rm) {
            const off = Number(rm[1]);
            const prev = offCount.get(a.personId) ?? 0;
            offCount.set(a.personId, off);
            add(a.personId, off > prev ? "oreb" : "dreb");
          }
          break;
        }
        case "Foul":
          // Technicals (and the team "defensive 3 second" technical) are not personal fouls.
          if (a.subType !== "Technical" && a.subType !== "Defense 3 Second") add(a.personId, "pf");
          break;
        case "Turnover": add(a.personId, "tov"); break;
        case "":
          if (/\bSTEAL\b/.test(d)) add(a.personId, "stl");
          else if (/\bBLOCK\b/.test(d)) add(a.personId, "blk");
          break;
      }
    }

    // Players who took part in this action (a substitution involves the player coming in, too).
    const appeared = [];
    if (person) appeared.push(a.personId);
    if (person && a.actionType === "Substitution") {
      const sm = /^SUB: (.+?) FOR /.exec(a.description);
      const inId = sm && bySurname[person.side].get(sm[1].trim().toLowerCase());
      if (inId) appeared.push(inId);
    }

    events.push({
      index: events.length,
      actionId: a.actionId,
      period: a.period,
      clock: formatClock(remaining),
      remaining,
      elapsed: elapsedSeconds(a.period, remaining),
      scoreHome: home,
      scoreAway: away,
      kind,
      side,
      personId: a.personId,
      actionType: a.actionType,
      description: a.description,
      scored,
      deltas,
      appeared,
    });
  }

  return { gameId: game.gameId, game, teams, players, events };
}

/** Points added by one team with no reply, in game order. */
export function findRuns(g, minPoints = RUN_MIN_POINTS) {
  const runs = [];
  let cur = null;
  let prevScoreIdx = -1; // event index of the previous scoring action
  const close = () => {
    if (cur && cur.points >= minPoints) runs.push(cur);
    cur = null;
  };

  for (const e of g.events) {
    if (!e.scored) continue;
    if (cur && cur.side !== e.scored.side) close();
    if (!cur) {
      const before = prevScoreIdx >= 0 ? g.events[prevScoreIdx] : null;
      cur = {
        side: e.scored.side,
        points: 0,
        // Window = everything after the opponent's last score, through this team's last score.
        windowStart: prevScoreIdx + 1,
        firstIndex: e.index,
        scoreBefore: { home: e.scoreHome - (e.scored.side === "home" ? e.scored.points : 0),
                       away: e.scoreAway - (e.scored.side === "away" ? e.scored.points : 0) },
        startElapsed: e.elapsed,
        startPeriod: e.period,
        startClock: e.clock,
      };
      void before;
    }
    cur.points += e.scored.points;
    cur.lastIndex = e.index;
    cur.windowEnd = e.index;
    cur.endElapsed = e.elapsed;
    cur.endPeriod = e.period;
    cur.endClock = e.clock;
    cur.scoreAfter = { home: e.scoreHome, away: e.scoreAway };
    prevScoreIdx = e.index;
  }
  close();

  // Opponent points scored since the run's first basket must be zero by construction.
  runs.forEach((r, i) => { r.number = i + 1; });
  return runs;
}

export function gameScore(s) {
  return (
    s.pts + 0.4 * s.fgm - 0.7 * s.fga - 0.4 * (s.fta - s.ftm) +
    0.7 * s.oreb + 0.3 * s.dreb + s.stl + 0.7 * s.ast + 0.7 * s.blk - 0.4 * s.pf - s.tov
  );
}

export function efficiency(s) {
  const reb = s.oreb + s.dreb;
  return s.pts + reb + s.ast + s.stl + s.blk - (s.fga - s.fgm) - (s.fta - s.ftm) - s.tov;
}

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Per-player stats over events[startIndex..endIndex] (inclusive).
 * Only players with a recorded stat, unless includeAppeared adds everyone who took part in any action.
 */
export function windowStats(g, startIndex, endIndex, { includeAppeared = false } = {}) {
  const byPlayer = new Map();
  for (let i = startIndex; i <= endIndex; i++) {
    const e = g.events[i];
    if (includeAppeared) for (const pid of e.appeared) if (!byPlayer.has(pid)) byPlayer.set(pid, blankStats());
    for (const d of e.deltas) {
      if (!byPlayer.has(d.pid)) byPlayer.set(d.pid, blankStats());
      byPlayer.get(d.pid)[d.stat] += d.n;
    }
  }
  return [...byPlayer].map(([pid, s]) => {
    const p = g.players.get(pid);
    return {
      personId: pid,
      name: p?.name ?? String(pid),
      side: p?.side,
      tricode: p ? g.teams[p.side].teamTricode : "",
      stats: s,
      gameScore: round1(gameScore(s)),
      eff: efficiency(s),
    };
  });
}

function extremes(list, key) {
  const best = Math.max(...list.map((p) => p[key]));
  const worst = Math.min(...list.map((p) => p[key]));
  const pick = (v) => list.filter((p) => p[key] === v);
  return { best: { value: best, players: pick(best) }, worst: { value: worst, players: pick(worst) } };
}

export function runReport(g, run) {
  const players = windowStats(g, run.windowStart, run.windowEnd)
    .sort((a, b) => b.gameScore - a.gameScore || b.eff - a.eff);
  return {
    players,
    gameScore: players.length ? extremes(players, "gameScore") : null,
    eff: players.length ? extremes(players, "eff") : null,
  };
}

/** Lead (home minus away) after each scoring action, starting from 0-0. */
export function leadSeries(g) {
  const pts = [{ elapsed: 0, lead: 0, home: 0, away: 0, event: null }];
  for (const e of g.events) {
    if (e.scored) pts.push({ elapsed: e.elapsed, lead: e.scoreHome - e.scoreAway, home: e.scoreHome, away: e.scoreAway, event: e });
  }
  return pts;
}

export function totalSeconds(g) {
  const last = Math.max(...g.events.map((e) => e.period));
  let t = 0;
  for (let p = 1; p <= last; p++) t += periodLength(p);
  return t;
}

/** Whole-game totals per side, for checking against the published team box score. */
export function teamTotals(g) {
  const out = { home: blankStats(), away: blankStats() };
  for (const e of g.events) {
    for (const d of e.deltas) {
      const p = g.players.get(d.pid);
      if (p) out[p.side][d.stat] += d.n;
    }
  }
  return out;
}

/** Whole-game player stats for one side ("home" | "away"), best Game Score first. */
export function playerGameStats(g, side) {
  return windowStats(g, 0, g.events.length - 1, { includeAppeared: true })
    .filter((p) => p.side === side)
    .sort((a, b) => b.gameScore - a.gameScore || b.eff - a.eff || a.name.localeCompare(b.name));
}
