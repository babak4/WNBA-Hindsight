import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { timeouts, eventRange, periodRanges, selectionSummary, windowReport, playerGameStats, buildGame, findRuns, runReport, teamTotals, leadSeries, gameScore, efficiency, parseClock, elapsedSeconds, formatClock } from "../web/model.js";

const dataDir = new URL("../data/", import.meta.url);
const files = readdirSync(dataDir).filter((f) => f.endsWith(".json") && f !== "index.json");

test("clock helpers", () => {
  assert.equal(parseClock("PT09M26.00S"), 566);
  assert.equal(parseClock("PT00M05.60S"), 5.6);
  assert.equal(elapsedSeconds(1, 600), 0);
  assert.equal(elapsedSeconds(2, 600), 600);
  assert.equal(elapsedSeconds(4, 0), 2400);
  assert.equal(formatClock(566), "9:26");
  assert.equal(formatClock(5.6), "0:05.6");
});

test("formulas", () => {
  const s = { pts: 20, fgm: 8, fga: 15, ftm: 4, fta: 6, oreb: 2, dreb: 5, ast: 4, stl: 2, blk: 1, pf: 3, tov: 3 };
  // 20 + 3.2 - 10.5 - 0.8 + 1.4 + 1.5 + 2 + 2.8 + 0.7 - 1.2 - 3
  assert.ok(Math.abs(gameScore(s) - 16.1) < 1e-9);
  // (20+7+4+2+1) = 34, minus (7 missed FG + 2 missed FT + 3 TOV) = 12
  assert.equal(efficiency(s), 34 - 12);
});

for (const f of files) {
  const raw = JSON.parse(readFileSync(new URL(f, dataDir), "utf8"));
  const g = buildGame(raw);

  test(`${f}: final score matches published score`, () => {
    const last = g.events.at(-1);
    assert.equal(last.scoreHome, g.teams.home.score);
    assert.equal(last.scoreAway, g.teams.away.score);
  });

  test(`${f}: derived totals match the team box score`, () => {
    const t = teamTotals(g);
    for (const side of ["home", "away"]) {
      const b = g.teams[side].statistics;
      assert.equal(t[side].pts, b.points, `${side} pts`);
      assert.equal(t[side].fgm, b.fieldGoalsMade, `${side} fgm`);
      assert.equal(t[side].fga, b.fieldGoalsAttempted, `${side} fga`);
      assert.equal(t[side].ftm, b.freeThrowsMade, `${side} ftm`);
      assert.equal(t[side].fta, b.freeThrowsAttempted, `${side} fta`);
      assert.equal(t[side].tpm, b.threePointersMade, `${side} 3pm`);
      assert.equal(t[side].tpa, b.threePointersAttempted, `${side} 3pa`);
      assert.equal(t[side].ast, b.assists, `${side} ast`);
      assert.equal(t[side].stl, b.steals, `${side} stl`);
      assert.equal(t[side].blk, b.blocks, `${side} blk`);
      assert.equal(t[side].pf, b.foulsPersonal, `${side} pf`);
      // box-score rebounds and turnovers include team ones, which have no player: derived <= published
      assert.ok(t[side].oreb <= b.reboundsOffensive, `${side} oreb`);
      assert.ok(t[side].dreb <= b.reboundsDefensive, `${side} dreb`);
      assert.ok(t[side].tov <= b.turnovers, `${side} tov`);
    }
  });

  test(`${f}: game player stats cover everyone who has stats, and sum to team totals`, () => {
    const t = teamTotals(g);
    for (const side of ["home", "away"]) {
      const list = playerGameStats(g, side);
      const withStats = new Set();
      for (const e of g.events) for (const d of e.deltas) if (g.players.get(d.pid)?.side === side) withStats.add(d.pid);
      for (const id of withStats) assert.ok(list.some((p) => p.personId === id), `${side} ${id} listed`);
      assert.ok(list.length >= withStats.size && list.length <= g.game[`${side}TeamPlayers`].length);
      assert.equal(list.reduce((n, p) => n + p.stats.pts, 0), t[side].pts);
    }
  });

  test(`${f}: period selections partition the game`, () => {
    const total = teamTotals(g);
    const sum = { home: {}, away: {} };
    let events = 0;
    for (const r of periodRanges(g)) {
      const sel = selectionSummary(g, r.from, r.to);
      assert.ok(sel.range, `${r.name} has events`);
      events += sel.range.end - sel.range.start + 1;
      for (const p of sel.report.players) {
        for (const [k, v] of Object.entries(p.stats)) sum[p.side][k] = (sum[p.side][k] ?? 0) + v;
      }
    }
    assert.equal(events, g.events.length, "every event is in exactly one period");
    for (const side of ["home", "away"]) {
      for (const k of ["pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "ast", "stl", "blk", "pf", "tov", "oreb", "dreb"]) {
        assert.equal(sum[side][k], total[side][k], `${side} ${k}`);
      }
    }
    const whole = selectionSummary(g, 0, 99999);
    assert.deepEqual(whole.scoreAfter, { home: g.teams.home.score, away: g.teams.away.score });
    assert.deepEqual(whole.scoreBefore, { home: 0, away: 0 });
    assert.equal(eventRange(g, 5000, 6000), null);
  });

  test(`${f}: team timeouts exclude official and reset rows`, () => {
    const list = timeouts(g);
    const expected = g.events.filter((e) => e.actionType === "Timeout" && e.kind === "team" && e.subType !== "Reset").length;
    assert.equal(list.length, expected);
    for (const t of list) {
      assert.ok(t.side === "home" || t.side === "away");
      assert.ok(!/Reset|Official/.test(t.description), t.description);
      assert.equal(t.lead, t.scoreHome - t.scoreAway);
    }
    for (let i = 1; i < list.length; i++) assert.ok(list[i].elapsed >= list[i - 1].elapsed);
  });

  test(`${f}: lead series is consistent`, () => {
    const s = leadSeries(g);
    assert.equal(s[0].lead, 0);
    for (let i = 1; i < s.length; i++) assert.ok(s[i].elapsed >= s[i - 1].elapsed);
    assert.equal(s.at(-1).lead, g.teams.home.score - g.teams.away.score);
  });

  test(`${f}: runs are unanswered and at least 7 points`, () => {
    const runs = findRuns(g);
    for (const r of runs) {
      assert.ok(r.points >= 7);
      let pts = 0;
      for (let i = r.firstIndex; i <= r.lastIndex; i++) {
        const sc = g.events[i].scored;
        if (sc) { assert.equal(sc.side, r.side); pts += sc.points; }
      }
      assert.equal(pts, r.points);
      // the action just before the window is the opponent's last score (or game start)
      if (r.windowStart > 0) assert.ok(g.events[r.windowStart - 1].scored);
      const rep = runReport(g, r);
      assert.ok(rep.players.length > 0);
    }
    for (let i = 1; i < runs.length; i++) assert.ok(runs[i].firstIndex > runs[i - 1].lastIndex);
  });
}
