import { buildGame, findRuns, runReport, leadSeries, periodName, periodRanges, selectionSummary } from "./model.js";
import { createChart, timeAt } from "./chart.js";
import { renderStats } from "./statsView.js";
import { initTheme } from "./theme.js";

const $ = (id) => document.getElementById(id);
const els = {
  select: $("game-select"), runs: $("show-runs"), players: $("show-players"), hint: $("players-hint"),
  summary: $("game-summary"), message: $("message"), legend: $("legend"), chart: $("chart"),
  note: $("chart-note"), runList: $("runs"), tableView: $("table-view"), table: $("plays-table"),
  stats: $("stats"), theme: $("theme-toggle"),
  selection: $("selection"), chips: $("period-chips"), clearSel: $("clear-selection"),
  tabs: [$("tab-lead"), $("tab-stats")],
  panels: [$("panel-lead"), $("panel-stats")],
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const num = (n, dp = 0) => (n < 0 ? "−" : "") + Math.abs(n).toFixed(dp);

let index = [];
let game = null, runs = [], chart = null;
let selection = null; // {from, to} in elapsed game seconds, picked on the chart
const cache = new Map();

const slugNumber = (slug) => Number(/(\d+)$/.exec(slug)?.[1] ?? -1);

function say(html) { els.message.innerHTML = html; els.message.hidden = !html; }

function dateText(gameEt) {
  // gameEt is local Eastern time stamped with a "Z"; read the calendar date from the text, don't convert zones.
  return new Date(`${gameEt.slice(0, 10)}T00:00:00Z`)
    .toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}

function optionLabel(e) {
  return `${dateText(e.gameEt)} · ${e.away.tricode} ${e.away.score} @ ${e.home.tricode} ${e.home.score}${e.label ? " · " + e.label : ""}`;
}

async function init() {
  try {
    const res = await fetch("../data/index.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    index = (await res.json()).games;
    // Highest game number (the digits at the end of the slug) first, so the top option is the default.
    index.sort((a, b) => slugNumber(b.slug) - slugNumber(a.slug) || b.slug.localeCompare(a.slug));
  } catch (err) {
    say(`Could not load <code>data/index.json</code> (${esc(err.message)}). Serve the project folder over HTTP ` +
        `(<code>uv run python -m http.server 8000</code>, then open <code>http://localhost:8000/web/</code>); ` +
        `opening the file directly does not work. If the file is missing, run <code>uv run index_games.py</code>.`);
    els.select.innerHTML = "<option>No games available</option>";
    return;
  }
  if (!index.length) {
    say("No games stored yet. Run <code>uv run fetch_pbp.py &lt;url&gt;</code> to add one.");
    els.select.innerHTML = "<option>No games available</option>";
    return;
  }
  els.select.innerHTML = index.map((e) => `<option value="${esc(e.slug)}">${esc(optionLabel(e))}</option>`).join("");
  els.select.disabled = false;
  const wanted = decodeURIComponent(location.hash.slice(1));
  if (index.some((e) => e.slug === wanted)) els.select.value = wanted;
  await loadGame(els.select.value);
}

async function loadGame(slug) {
  const entry = index.find((e) => e.slug === slug);
  say("");
  try {
    if (!cache.has(slug)) {
      const res = await fetch(`../data/${encodeURIComponent(entry.file)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cache.set(slug, buildGame(await res.json()));
    }
  } catch (err) {
    say(`Could not load ${esc(entry.file)}: ${esc(err.message)}`);
    return;
  }
  game = cache.get(slug);
  runs = findRuns(game);
  renderAll(entry);
}

function scoreboardHtml(entry) {
  const { home, away } = game.teams;
  const meta = [entry.label, dateText(entry.gameEt), entry.status].filter(Boolean).map(esc).join(" · ");
  const team = (t, side) => `
    <div class="sb-team ${side}${t.score > (side === "home" ? away : home).score ? " winner" : ""}">
      <div class="sb-id"><span class="sb-tri">${esc(t.teamTricode)}</span><span class="sb-name">${esc(t.teamCity)} ${esc(t.teamName)}</span></div>
      <div class="sb-score">${t.score}</div>
    </div>`;
  return `<p class="sb-meta">${meta}</p>
    <div class="sb-teams">${team(away, "away")}<span class="sb-at" aria-hidden="true">at</span>${team(home, "home")}</div>`;
}

function renderAll(entry) {
  const { home, away } = game.teams;
  els.summary.innerHTML = scoreboardHtml(entry);
  els.legend.innerHTML =
    `<li><span class="swatch home"></span>${esc(home.teamCity)} ${esc(home.teamName)} (${esc(home.teamTricode)}, home) ahead</li>` +
    `<li><span class="swatch away"></span>${esc(away.teamCity)} ${esc(away.teamName)} (${esc(away.teamTricode)}, away) ahead</li>`;

  chart?.destroy();
  chart = createChart(els.chart, game, {
    runs,
    showRuns: els.runs.checked,
    onRunHover: (n) => setActiveRun(n),
    onSelect: (sel) => setSelection(sel, false),
  });
  selection = null;
  renderChips();
  renderSelection();

  renderRunCards();
  renderTable();
  renderStats(els.stats, game);
  syncControls();
}

function syncControls() {
  const on = els.runs.checked;
  els.players.disabled = !on;
  els.hint.hidden = on;
  els.note.hidden = !on;
  els.note.textContent = on
    ? (runs.length
        ? `Arrows mark ${runs.length} run${runs.length === 1 ? "" : "s"} of 7+ unanswered points, from the lead before the run's first score to the lead after its last.`
        : "No team scored 7+ unanswered points in this game.")
    : "";
  els.runList.hidden = !(on && els.players.checked && runs.length);
  chart?.setShowRuns(on);
}

function setActiveRun(n) {
  chart?.setActive(n);
  for (const card of els.runList.querySelectorAll(".run-card")) {
    card.classList.toggle("active", Number(card.dataset.run) === n);
  }
}

function who(list, key, fmt) {
  // list: {value, players[]}
  const names = list.players.map((p) =>
    `<span class="name-line"><span class="team-chip bg-${p.side}"></span>${esc(p.name)} <span class="tag">${esc(p.tricode)}</span></span>`).join("");
  return `<span class="names">${names}</span><span class="val">${fmt(list.value)}</span>`;
}

/** Best/worst blocks plus the all-players table, shared by run cards and the selected-period card. */
function reportBody(rep, noun) {
  const metric = (title, m, key, fmt) => `
    <div class="metric"><h4>${title}</h4>
      <div class="who"><span class="tag">Best</span>${who(m.best, key, fmt)}</div>
      <div class="who"><span class="tag">Worst</span>${who(m.worst, key, fmt)}</div>
    </div>`;
  const rows = rep.players.map((p) => {
    const s = p.stats;
    return `<tr><td>${esc(p.name)}</td><td>${esc(p.tricode)}</td><td>${s.pts}</td><td>${s.fgm}/${s.fga}</td><td>${s.ftm}/${s.fta}</td>` +
      `<td>${s.oreb + s.dreb}</td><td>${s.ast}</td><td>${s.stl}</td><td>${s.blk}</td><td>${s.pf}</td><td>${s.tov}</td>` +
      `<td>${num(p.gameScore, 1)}</td><td>${num(p.eff)}</td></tr>`;
  }).join("");
  return `
    <div class="metrics">
      ${metric("Game Score", rep.gameScore, "gameScore", (v) => num(v, 1))}
      ${metric("Efficiency (EFF)", rep.eff, "eff", (v) => num(v))}
    </div>
    <details><summary>All ${rep.players.length} players in this ${noun}</summary>
      <div class="table-scroll"><table>
        <thead><tr><th>Player</th><th>Tm</th><th>PTS</th><th>FG</th><th>FT</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>PF</th><th>TO</th><th>GmSc</th><th>EFF</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </details>`;
}

function renderRunCards() {
  const { home, away } = game.teams;
  els.runList.innerHTML = runs.map((r) => {
    const rep = runReport(game, r);
    const side = r.side === "home" ? home : away;
    const when = r.startPeriod === r.endPeriod
      ? `${periodName(r.startPeriod)} ${r.startClock} – ${r.endClock}`
      : `${periodName(r.startPeriod)} ${r.startClock} – ${periodName(r.endPeriod)} ${r.endClock}`;
    return `
    <article class="run-card ${r.side}" data-run="${r.number}">
      <h3><span class="num">#${r.number}</span> ${esc(side.teamTricode)} ${r.points}–0 run</h3>
      <p class="when">${when} · ${esc(home.teamTricode)} ${r.scoreBefore.home}–${r.scoreBefore.away} ${esc(away.teamTricode)}
        → ${r.scoreAfter.home}–${r.scoreAfter.away}</p>
      ${reportBody(rep, "run")}
    </article>`;
  }).join("");

  for (const card of els.runList.querySelectorAll(".run-card")) {
    const n = Number(card.dataset.run);
    card.addEventListener("pointerenter", () => setActiveRun(n));
    card.addEventListener("pointerleave", () => setActiveRun(null));
    card.addEventListener("focusin", () => setActiveRun(n));
    card.addEventListener("focusout", () => setActiveRun(null));
  }
}

// Selected period (drag on the chart, or a quarter button)
const sameSel = (a, b) => !!a && !!b && a.from === b.from && a.to === b.to;

function renderChips() {
  els.chips.innerHTML = periodRanges(game)
    .map((r) => `<button type="button" class="chip" data-from="${r.from}" data-to="${r.to}" aria-pressed="false">${esc(r.name)}</button>`)
    .join("");
}

function setSelection(sel, pushToChart = true) {
  selection = sel;
  if (pushToChart) chart?.setSelection(sel);
  renderSelection();
}

function renderSelection() {
  for (const b of els.chips.querySelectorAll(".chip")) {
    b.setAttribute("aria-pressed", String(sameSel(selection, { from: Number(b.dataset.from), to: Number(b.dataset.to) })));
  }
  els.clearSel.hidden = !selection;
  els.selection.hidden = !selection;
  if (!selection) { els.selection.innerHTML = ""; return; }

  const { home, away } = game.teams;
  const sum = selectionSummary(game, selection.from, selection.to);
  const span = selection.to - selection.from;
  const title = `${timeAt(selection.from, game, true)} – ${timeAt(selection.to, game)}`;
  let body;
  if (!sum.range) {
    body = `<p class="when">No plays were recorded in this period.</p>`;
  } else {
    const dh = sum.scoreAfter.home - sum.scoreBefore.home, da = sum.scoreAfter.away - sum.scoreBefore.away;
    body = `<p class="when">${Math.floor(span / 60)}:${String(span % 60).padStart(2, "0")} of game time · ` +
      `${esc(home.teamTricode)} ${sum.scoreBefore.home}–${sum.scoreBefore.away} ${esc(away.teamTricode)} → ` +
      `${sum.scoreAfter.home}–${sum.scoreAfter.away} · ${esc(home.teamTricode)} scored ${dh}, ${esc(away.teamTricode)} scored ${da}</p>` +
      (sum.report.players.length
        ? reportBody(sum.report, "period")
        : `<p class="when">No player actions were recorded in this period.</p>`);
  }
  els.selection.innerHTML = `
    <article class="run-card selection-card">
      <h3>Selected period <span class="num">${esc(title)}</span></h3>
      ${body}
    </article>`;
}

els.chips.addEventListener("click", (ev) => {
  const b = ev.target.closest(".chip");
  if (!b) return;
  const sel = { from: Number(b.dataset.from), to: Number(b.dataset.to) };
  setSelection(sameSel(selection, sel) ? null : sel);
});
els.clearSel.addEventListener("click", () => setSelection(null));

function renderTable() {
  const { home, away } = game.teams;
  const rows = leadSeries(game).slice(1).map((p) => {
    const lead = p.lead === 0 ? "Tied" : `${p.lead > 0 ? home.teamTricode : away.teamTricode} +${Math.abs(p.lead)}`;
    return `<tr><td>${timeAt(p.elapsed, game)}</td><td>${p.home}–${p.away}</td><td>${lead}</td><td>${esc(p.event.description)}</td></tr>`;
  }).join("");
  els.table.innerHTML =
    `<thead><tr><th>Time</th><th>${esc(home.teamTricode)}–${esc(away.teamTricode)}</th><th>Lead</th><th>Scoring play</th></tr></thead><tbody>${rows}</tbody>`;
  els.tableView.hidden = false;
}

// Tabs: the lead tracker is always the first thing shown.
function selectTab(i, focus = false) {
  els.tabs.forEach((t, n) => {
    t.setAttribute("aria-selected", String(n === i));
    t.tabIndex = n === i ? 0 : -1;
    els.panels[n].hidden = n !== i;
  });
  if (focus) els.tabs[i].focus();
}
els.tabs.forEach((t, i) => {
  t.addEventListener("click", () => selectTab(i));
  t.addEventListener("keydown", (ev) => {
    const n = els.tabs.length;
    const next = { ArrowRight: (i + 1) % n, ArrowLeft: (i + n - 1) % n, Home: 0, End: n - 1 }[ev.key];
    if (next !== undefined) { ev.preventDefault(); selectTab(next, true); }
  });
});

els.select.addEventListener("change", () => {
  // Only an explicit choice goes into the URL, so a plain visit or reload still opens the highest-numbered game.
  history.replaceState(null, "", `#${encodeURIComponent(els.select.value)}`);
  loadGame(els.select.value);
});
els.runs.addEventListener("change", () => {
  if (!els.runs.checked) els.players.checked = false;
  syncControls();
});
els.players.addEventListener("change", syncControls);

initTheme(els.theme);
init();
