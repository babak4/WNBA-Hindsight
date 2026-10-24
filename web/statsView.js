// "Player stats" tab: one sortable table per team, from whole-game player stats.
import { playerGameStats } from "./model.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const num = (n, dp = 0) => (n < 0 ? "−" : "") + Math.abs(n).toFixed(dp);

// key: sort value; text: cell text; dp: decimals for numeric cells
const COLUMNS = [
  { id: "name", label: "Player", sort: (p) => p.name, text: (p) => esc(p.name), left: true },
  { id: "gs", label: "Game Score", title: "Hollinger Game Score", sort: (p) => p.gameScore, text: (p) => num(p.gameScore, 1), metric: true },
  { id: "eff", label: "EFF", title: "Efficiency", sort: (p) => p.eff, text: (p) => num(p.eff), metric: true },
  { id: "pts", label: "PTS", title: "Points", sort: (p) => p.stats.pts },
  { id: "fg", label: "FG", title: "Field goals made-attempted", sort: (p) => p.stats.fgm, text: (p) => `${p.stats.fgm}-${p.stats.fga}` },
  { id: "tp", label: "3P", title: "Three-pointers made-attempted", sort: (p) => p.stats.tpm, text: (p) => `${p.stats.tpm}-${p.stats.tpa}` },
  { id: "ft", label: "FT", title: "Free throws made-attempted", sort: (p) => p.stats.ftm, text: (p) => `${p.stats.ftm}-${p.stats.fta}` },
  { id: "oreb", label: "OR", title: "Offensive rebounds", sort: (p) => p.stats.oreb },
  { id: "dreb", label: "DR", title: "Defensive rebounds", sort: (p) => p.stats.dreb },
  { id: "reb", label: "REB", title: "Total rebounds", sort: (p) => p.stats.oreb + p.stats.dreb, text: (p) => p.stats.oreb + p.stats.dreb },
  { id: "ast", label: "AST", title: "Assists", sort: (p) => p.stats.ast },
  { id: "stl", label: "STL", title: "Steals", sort: (p) => p.stats.stl },
  { id: "blk", label: "BLK", title: "Blocks", sort: (p) => p.stats.blk },
  { id: "tov", label: "TO", title: "Turnovers", sort: (p) => p.stats.tov },
  { id: "pf", label: "PF", title: "Personal fouls", sort: (p) => p.stats.pf },
];

const SUM_KEYS = ["pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf"];

function totalsRow(list) {
  const stats = Object.fromEntries(SUM_KEYS.map((k) => [k, list.reduce((n, p) => n + p.stats[k], 0)]));
  return {
    name: "Team (players only)",
    stats,
    gameScore: Math.round(list.reduce((n, p) => n + p.gameScore, 0) * 10) / 10,
    eff: list.reduce((n, p) => n + p.eff, 0),
  };
}

function leaders(g, lists) {
  const all = lists.flat();
  const top = (key) => {
    const v = Math.max(...all.map((p) => p[key]));
    return { v, who: all.filter((p) => p[key] === v) };
  };
  const chip = (title, t, fmt) =>
    `<div class="leader"><span class="leader-title">${title}</span><span class="leader-who">${
      t.who.map((p) => `<span class="name-line"><span class="team-chip bg-${p.side}"></span>${esc(p.name)} <span class="tag">${esc(p.tricode)}</span></span>`).join("")
    }</span><span class="leader-val">${fmt(t.v)}</span></div>`;
  return `<div class="leaders" aria-label="Game leaders">
    ${chip("Best Game Score", top("gameScore"), (v) => num(v, 1))}
    ${chip("Best EFF", top("eff"), (v) => num(v))}
  </div>`;
}

export function renderStats(el, g) {
  const sides = ["home", "away"];
  const lists = sides.map((s) => playerGameStats(g, s));
  const sort = { home: { id: "gs", dir: -1 }, away: { id: "gs", dir: -1 } };

  function tableFor(side, i) {
    const t = g.teams[side];
    const { id, dir } = sort[side];
    const col = COLUMNS.find((c) => c.id === id);
    const rows = [...lists[i]].sort((a, b) => {
      const x = col.sort(a), y = col.sort(b);
      const cmp = typeof x === "string" ? x.localeCompare(y) : x - y;
      return cmp * dir || a.name.localeCompare(b.name);
    });
    const cell = (c, p) => `<td class="${c.metric ? "metric" : ""}${c.left ? " left" : ""}">${c.text ? c.text(p) : p.stats[c.id]}</td>`;
    const head = COLUMNS.map((c) => {
      const sorted = c.id === id;
      const aria = sorted ? (dir < 0 ? "descending" : "ascending") : "none";
      return `<th scope="col" aria-sort="${aria}" class="${c.metric ? "metric" : ""}${c.left ? " left" : ""}">
        <button type="button" data-sort="${c.id}" title="${esc(c.title || c.label)}">${esc(c.label)}<span class="arrow" aria-hidden="true">${sorted ? (dir < 0 ? "▼" : "▲") : ""}</span></button></th>`;
    }).join("");
    const total = totalsRow(lists[i]);
    return `
      <section class="team-stats" data-side="${side}" aria-labelledby="team-${side}">
        <h2 id="team-${side}"><span class="swatch ${side}"></span>${esc(t.teamCity)} ${esc(t.teamName)}
          <span class="team-score">${t.score}</span><span class="team-role">${side === "home" ? "home" : "away"}</span></h2>
        <div class="table-scroll stats-scroll">
          <table class="stats-table">
            <thead><tr>${head}</tr></thead>
            <tbody>${rows.map((p) => `<tr>${COLUMNS.map((c) => cell(c, p)).join("")}</tr>`).join("")}</tbody>
            <tfoot><tr>${COLUMNS.map((c) => cell(c, total)).join("")}</tr></tfoot>
          </table>
        </div>
      </section>`;
  }

  function draw() {
    el.innerHTML = leaders(g, lists) + sides.map(tableFor).join("") +
      `<p class="note">Players who took part in the game are listed (${lists[0].length} and ${lists[1].length}). Click a column heading to sort. ` +
      `Team rebounds and team turnovers are not credited to a player, so rebound and turnover columns can sit below the official team totals.</p>`;
  }

  el.onclick = (ev) => {
    const btn = ev.target.closest("button[data-sort]");
    if (!btn) return;
    const side = btn.closest("[data-side]").dataset.side;
    const id = btn.dataset.sort;
    sort[side] = sort[side].id === id ? { id, dir: -sort[side].dir } : { id, dir: id === "name" ? 1 : -1 };
    draw();
    el.querySelector(`[data-side="${side}"] button[data-sort="${id}"]`)?.focus();
  };

  draw();
}
