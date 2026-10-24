// SVG lead tracker. Draws from model output only; no game logic here.
import { leadSeries, totalSeconds, periodLength, periodName, formatClock } from "./model.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const minus = (n) => (n < 0 ? "−" : "") + Math.abs(n);
const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n);

/** period + clock text for an elapsed-seconds value */
export function timeAt(elapsed, g) {
  let t = elapsed, p = 1;
  const last = Math.max(...g.events.map((e) => e.period));
  while (p < last && t > periodLength(p)) { t -= periodLength(p); p++; }
  return `${periodName(p)} ${formatClock(Math.max(0, periodLength(p) - t))}`;
}

let uid = 0;

/**
 * @param {HTMLElement} el container
 * @param {object} g game from buildGame
 * @param {{runs: object[], showRuns: boolean, onRunHover: (n:number|null)=>void}} opts
 */
export function createChart(el, g, opts) {
  const series = leadSeries(g);
  const total = totalSeconds(g);
  const home = g.teams.home.teamTricode, away = g.teams.away.teamTricode;
  const id = `lt${++uid}`;
  let active = null;
  let state = { showRuns: opts.showRuns };

  // Zero stays on the chart, but each side only gets as much room as the biggest lead it needs.
  const maxHome = Math.max(0, ...series.map((p) => p.lead));
  const maxAway = Math.max(0, ...series.map((p) => -p.lead));
  const maxAbs = Math.max(maxHome, maxAway);
  const step = maxAbs <= 12 ? 5 : maxAbs <= 40 ? 10 : 20;
  const top = Math.max(10, Math.ceil((maxHome + 1) / step) * step);
  const bottom = Math.max(10, Math.ceil((maxAway + 1) / step) * step);

  let geo = null;

  function draw() {
    const W = Math.max(320, Math.floor(el.clientWidth));
    const H = Math.round(Math.min(460, Math.max(300, W * 0.45)));
    const m = { t: 20, r: 14, b: 30, l: 40 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const x = (s) => m.l + (s / total) * pw;
    const y = (v) => m.t + ((top - v) / (top + bottom)) * ph;
    const y0 = y(0);
    geo = { W, H, m, pw, ph, x, y };

    const periods = [];
    for (let p = 1, t = 0; t < total; p++) { periods.push({ p, from: t, to: t + periodLength(p) }); t += periodLength(p); }

    let s = "";
    // bands + period labels
    periods.forEach(({ p, from, to }, i) => {
      if (i % 2 === 1) s += `<rect class="band" x="${x(from)}" y="${m.t}" width="${x(to) - x(from)}" height="${ph}"/>`;
      s += `<text class="ax-label" x="${(x(from) + x(to)) / 2}" y="${H - 10}" text-anchor="middle">${periodName(p)}</text>`;
      if (i > 0) s += `<line class="period-line" x1="${x(from)}" x2="${x(from)}" y1="${m.t}" y2="${m.t + ph}"/>`;
    });
    // y grid + ticks
    for (let v = -bottom; v <= top; v += step) {
      s += `<line class="${v === 0 ? "zero-line" : "grid-line"}" x1="${m.l}" x2="${m.l + pw}" y1="${y(v)}" y2="${y(v)}"/>`;
      s += `<text class="ax-text" x="${m.l - 6}" y="${y(v)}" text-anchor="end" dominant-baseline="central">${v === 0 ? "0" : signed(v)}</text>`;
    }
    s += `<text class="ax-label" x="${m.l + 6}" y="${m.t + 12}">${esc(home)} ahead</text>`;
    s += `<text class="ax-label" x="${m.l + 6}" y="${m.t + ph - 6}">${esc(away)} ahead</text>`;

    s += "<!--wins-->";
    // step path (lead holds until the next score)
    let d = `M${x(series[0].elapsed)},${y(series[0].lead)}`;
    for (let i = 1; i < series.length; i++) d += `H${x(series[i].elapsed)}V${y(series[i].lead)}`;
    d += `H${x(total)}`;
    const area = `${d}V${y0}H${x(0)}Z`;
    s += `<defs>
      <clipPath id="${id}-up"><rect x="${m.l}" y="${m.t}" width="${pw}" height="${y0 - m.t}"/></clipPath>
      <clipPath id="${id}-dn"><rect x="${m.l}" y="${y0}" width="${pw}" height="${m.t + ph - y0}"/></clipPath>
    </defs>`;
    s += `<path d="${area}" fill="var(--home)" fill-opacity="0.28" clip-path="url(#${id}-up)"/>`;
    s += `<path d="${area}" fill="var(--away)" fill-opacity="0.28" clip-path="url(#${id}-dn)"/>`;
    s += `<path d="${d}" fill="none" stroke="var(--home)" stroke-width="2" stroke-linejoin="round" clip-path="url(#${id}-up)"/>`;
    s += `<path d="${d}" fill="none" stroke="var(--away)" stroke-width="2" stroke-linejoin="round" clip-path="url(#${id}-dn)"/>`;

    let wins = "";
    // runs (window shading is collected separately so it sits behind the lead line)
    const mainSvg = s;
    s = "";
    if (state.showRuns) {
      for (const r of opts.runs) {
        const color = r.side === "home" ? "var(--home)" : "var(--away)";
        const x1 = x(r.startElapsed), x2 = x(r.endElapsed);
        const y1 = y(r.scoreBefore.home - r.scoreBefore.away), y2 = y(r.scoreAfter.home - r.scoreAfter.away);
        const ws = g.events[r.windowStart].elapsed, we = g.events[r.windowEnd].elapsed;
        wins += `<rect class="win" data-run="${r.number}" x="${x(ws)}" y="${m.t}" width="${Math.max(2, x(we) - x(ws))}" height="${ph}" fill="${color}"/>`;
        let dx = x2 - x1, dy = y2 - y1;
        let len = Math.hypot(dx, dy);
        if (len < 6) { dx = 6; dy = 0; len = 6; }
        const ux = dx / len, uy = dy / len;
        const head = 10;
        const bx = x2 - ux * head, by = y2 - uy * head;
        const px = -uy * 5, py = ux * 5;
        const headPts = `${x2},${y2} ${bx + px},${by + py} ${bx - px},${by - py}`;
        const w = 3;
        s += `<g data-run="${r.number}">`;
        s += `<line class="run-hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="transparent" stroke-width="18"/>`;
        s += `<line class="halo" x1="${x1}" y1="${y1}" x2="${bx}" y2="${by}" stroke-width="${w + 4}"/>`;
        s += `<polygon points="${headPts}" fill="var(--surface-1)" stroke="var(--surface-1)" stroke-width="4" stroke-linejoin="round"/>`;
        s += `<line class="main" x1="${x1}" y1="${y1}" x2="${bx}" y2="${by}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
        s += `<polygon points="${headPts}" fill="${color}"/>`;
        // numbered badge, offset to the side of the arrow that has the most room
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const off = 15;
        let nx = uy * off, ny = -ux * off;
        if (my + ny < m.t + 10 || my + ny > m.t + ph - 10) { nx = -nx; ny = -ny; }
        s += `<circle class="run-badge run-hit" cx="${mx + nx}" cy="${my + ny}" r="9" stroke="${color}"/>`;
        s += `<text class="run-num" x="${mx + nx}" y="${my + ny}">${r.number}</text>`;
        s += `</g>`;
      }
    }

    s = mainSvg.replace("<!--wins-->", wins) + s;
    s += `<g class="hover" visibility="hidden"><line class="cross" y1="${m.t}" y2="${m.t + ph}"/><circle class="cross-dot" r="4.5"/></g>`;

    const label = `Lead tracker: ${g.teams.home.teamName} ${g.teams.home.score}, ${g.teams.away.teamName} ${g.teams.away.score}. ` +
      `Largest lead ${maxAbs}. ${state.showRuns ? `${opts.runs.length} runs of 7 or more unanswered points highlighted.` : ""}`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${s}</svg><div class="tooltip" hidden></div>`;
    bind();
    applyActive();
  }

  function applyActive() {
    for (const n of el.querySelectorAll("[data-run]")) n.classList.toggle("active", Number(n.dataset.run) === active);
  }

  function leadAt(t) {
    let lo = 0, hi = series.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (series[mid].elapsed <= t) lo = mid; else hi = mid - 1;
    }
    return series[lo];
  }

  function bind() {
    const svg = el.querySelector("svg"), tip = el.querySelector(".tooltip"), hover = svg.querySelector(".hover");
    const { m, pw, ph, x, y } = geo;
    const showTip = (html, px, py) => {
      tip.innerHTML = html;
      tip.hidden = false;
      const w = tip.offsetWidth, h = tip.offsetHeight;
      const left = Math.min(Math.max(4, px + 14), el.clientWidth - w - 4);
      const top = py - h - 12 < 0 ? py + 16 : py - h - 12;
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    };
    const hide = () => { tip.hidden = true; hover.setAttribute("visibility", "hidden"); };

    svg.addEventListener("pointermove", (ev) => {
      const box = svg.getBoundingClientRect();
      const px = ((ev.clientX - box.left) / box.width) * geo.W;
      const py = ((ev.clientY - box.top) / box.height) * geo.H;
      const runEl = ev.target.closest("[data-run]");
      if (runEl) {
        const r = opts.runs.find((q) => q.number === Number(runEl.dataset.run));
        hover.setAttribute("visibility", "hidden");
        opts.onRunHover(r.number);
        const side = r.side === "home" ? home : away;
        showTip(
          `<div class="t-time">Run #${r.number}</div><div class="t-score">${esc(side)} ${r.points}–0</div>` +
          `<div class="t-play">${timeAt(r.startElapsed, g)} to ${timeAt(r.endElapsed, g)}<br>${esc(home)} ${r.scoreBefore.home}–${r.scoreBefore.away} ${esc(away)} → ${r.scoreAfter.home}–${r.scoreAfter.away}</div>`,
          ev.clientX - el.getBoundingClientRect().left, ev.clientY - el.getBoundingClientRect().top);
        return;
      }
      if (active !== null) opts.onRunHover(null);
      if (px < m.l || px > m.l + pw || py < m.t || py > m.t + ph) { hide(); return; }
      const t = ((px - m.l) / pw) * total;
      const p = leadAt(t);
      hover.setAttribute("visibility", "visible");
      hover.querySelector("line").setAttribute("x1", px);
      hover.querySelector("line").setAttribute("x2", px);
      const dot = hover.querySelector("circle");
      dot.setAttribute("cx", px); dot.setAttribute("cy", y(p.lead));
      const lead = p.lead === 0 ? "Tied" : `${p.lead > 0 ? home : away} +${Math.abs(p.lead)}`;
      const play = p.event ? `<div class="t-play">Last score (${timeAt(p.event.elapsed, g)}): ${esc(p.event.description)}</div>` : "";
      showTip(
        `<div class="t-time">${timeAt(t, g)}</div><div class="t-score">${esc(home)} ${p.home} – ${p.away} ${esc(away)}</div><div>${lead}</div>${play}`,
        ev.clientX - el.getBoundingClientRect().left, ev.clientY - el.getBoundingClientRect().top);
    });
    svg.addEventListener("pointerleave", () => { hide(); if (state.showRuns) opts.onRunHover(null); });
  }

  function setActive(n) {
    if (active === n) return;
    active = n;
    applyActive();
  }

  const ro = new ResizeObserver(() => draw());
  ro.observe(el);
  draw();

  return {
    setShowRuns(v) { state = { ...state, showRuns: v }; draw(); },
    setActive,
    destroy() { ro.disconnect(); el.innerHTML = ""; },
  };
}
