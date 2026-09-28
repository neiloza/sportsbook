/* ============================================================================
 * Scorecard — what HAPPENED (final results by week) and Pick'em, the
 * prediction game (docs/PLAN.md §5).
 *
 * Solo pick'em is local-first and free: picks live in state.picks and are
 * graded on this device the first time the app sees the game final. A
 * premium user in pick'em leagues also has each pick sent to every league of
 * that competition, where the SERVER enforces the kickoff lock — a device
 * clock is fine for competing with yourself and useless against rivals.
 * ========================================================================= */

import { el, mount, eventCard, asOf, emptyState, loading, offlineState, segmented } from "../dom.js";
import { getPublic, callPrivate } from "../api.js";
import { gradePick, pickLocked, pickStats, weeklySeries } from "../logic.js";
import { leaguesPanel } from "./leagues.js";

export function createScorecardView(ctx) {
  const root = document.getElementById("view-scorecard");
  let seq = 0;

  const comp = () => ctx.primaryComp();

  async function render() {
    const my = ++seq;
    const mode = ctx.state.settings.scorecardMode === "pickem" ? "pickem" : "results";
    const body = el("div", {}, loading());
    mount(root, ctx.banner(), segmented(
      [["results", "Results"], ["pickem", "Pick'em"]], mode,
      (v) => { ctx.state.settings.scorecardMode = v; ctx.persist(); render(); }, "Scorecard section"), body);
    if (mode === "results") await renderResults(body, my);
    else await renderPickem(body, my);
  }

  /* --- results ------------------------------------------------------------ */

  async function renderResults(body, my) {
    const c = comp();
    const r = await getPublic(`/v1/sb/results?comp=${encodeURIComponent(c.id)}&weeks=4`);
    if (my !== seq) return;
    if (!r.data) return mount(body, offlineState(render));
    gradeFrom(r.data.weeks?.flatMap((w) => w.events) ?? []);
    const weeks = r.data.weeks ?? [];
    if (!weeks.length) return mount(body, emptyState("No results yet", "Final scores appear here once games finish."));
    mount(body, asOf(r.data, r.stale), weeks.map((w) => el("section", { class: "section" }, [
      el("h2", { class: "section-head" }, `Week ${w.week}`),
      el("div", { class: "card-list" }, w.events.map((e) => eventCard(e, {
        onOpen: (ev) => ctx.openEvent(ev.id),
        extra: pickBadge(ctx.state.picks[e.id]),
      }))),
    ])));
  }

  /* --- pick'em ------------------------------------------------------------ */

  async function renderPickem(body, my) {
    const c = comp();
    const [up, res] = await Promise.all([
      getPublic(`/v1/sb/upcoming?comp=${encodeURIComponent(c.id)}&days=10`),
      getPublic(`/v1/sb/results?comp=${encodeURIComponent(c.id)}&weeks=4`),
    ]);
    if (my !== seq) return;
    gradeFrom([...(res.data?.weeks?.flatMap((w) => w.events) ?? []), ...(up.data?.events ?? [])]);
    await gradeStragglers();
    if (my !== seq) return;

    const stats = pickStats(ctx.state.picks);
    const upcoming = up.data?.events ?? [];

    mount(body,
      statsCard(stats),
      chart(weeklySeries(ctx.state.picks)),
      el("section", { class: "section" }, [
        el("h2", { class: "section-head" }, "Make your picks"),
        el("p", { class: "section-sub" }, `Tap who wins. Picks lock at kickoff.${c.draws ? " Draws count." : ""}`),
        up.data ? asOf(up.data, up.stale) : null,
        !up.data ? offlineState(render)
          : upcoming.length ? el("div", { class: "card-list" }, upcoming.map((e) => pickRow(e, c)))
            : emptyState("Nothing to pick right now", "The next games show here once they're scheduled."),
      ]),
      leaguesPanel(ctx, { kind: "pickem", comp: c.id, title: "Pick'em leagues" }),
      historySection(),
    );
  }

  function pickRow(event, c) {
    const mine = ctx.state.picks[event.id]?.pick;
    const locked = pickLocked(event);
    const option = (side, label) => el("button", {
      class: `pick-btn${mine === side ? " picked" : ""}`,
      type: "button",
      disabled: locked,
      "aria-pressed": mine === side ? "true" : "false",
      onclick: () => makePick(event, side),
    }, label);
    return el("div", { class: "pick-row" }, [
      eventCard(event, { onOpen: (ev) => ctx.openEvent(ev.id) }),
      el("div", { class: "pick-options", role: "group", "aria-label": `Pick ${event.away.name} at ${event.home.name}` }, [
        option("away", event.away.abbr),
        c.draws ? option("draw", "Draw") : null,
        option("home", event.home.abbr),
        locked ? el("span", { class: "pick-locked" }, "🔒 Locked") : null,
      ]),
    ]);
  }

  function makePick(event, side) {
    if (pickLocked(event)) return ctx.toast("That game has kicked off.");
    ctx.state.picks[event.id] = {
      pick: side, at: Date.now(), comp: event.comp, season: event.season, week: event.week,
      start_time: event.start_time, home: event.home.abbr, away: event.away.abbr,
    };
    ctx.persist();
    render();
    // League picks: best effort, never blocking the local pick. A failure
    // here is shown once; the local pick stands either way.
    if (ctx.isPremium()) {
      for (const lg of ctx.leagues.filter((l) => l.kind === "pickem" && l.comp === event.comp)) {
        callPrivate("/v1/sb/league/picks", { method: "POST", body: { id: lg.id, event_id: event.id, pick: side } })
          .catch((err) => ctx.toast(`${lg.name}: ${err.message}`));
      }
    }
  }

  /** Write a result onto every pick whose game is now over. Written once:
   *  a later stat correction never flips a graded pick back and forth. */
  function gradeFrom(events) {
    let changed = false;
    for (const e of events) {
      const p = ctx.state.picks[e.id];
      if (!p || p.result) continue;
      const result = gradePick(p.pick, e);
      if (result) { p.result = result; changed = true; }
    }
    if (changed) ctx.persist();
  }

  /** Picks older than the results window, still ungraded (the app was not
   *  opened for a month): fetch those games one by one, a few per visit. */
  async function gradeStragglers() {
    const cutoff = Date.now() - 3 * 3600e3;
    const stale = Object.entries(ctx.state.picks)
      .filter(([, p]) => !p.result && Date.parse(p.start_time) < cutoff)
      .slice(0, 8);
    const got = await Promise.all(stale.map(([id]) => getPublic(`/v1/sb/event?id=${encodeURIComponent(id)}`)));
    gradeFrom(got.map((g) => g.data?.event).filter(Boolean));
  }

  function statsCard(s) {
    const tile = (label, value) => el("div", { class: "stat-tile" }, [
      el("span", { class: "stat-value" }, value), el("span", { class: "stat-label" }, label),
    ]);
    const streak = s.streak > 0 ? `W${s.streak}` : s.streak < 0 ? `L${-s.streak}` : "–";
    return el("div", { class: "panel stats-card" }, [
      el("h2", { class: "panel-head" }, "Your record"),
      el("div", { class: "stat-row" }, [
        tile("Record", s.total ? `${s.correct}–${s.wrong}` : "–"),
        tile("Correct", s.pct === null ? "–" : `${s.pct}%`),
        tile("Streak", streak),
        tile("Best run", s.best ? String(s.best) : "–"),
      ]),
      ctx.isPremium() ? null : el("p", { class: "panel-sub fine" },
        "Saved on this phone. Premium keeps your record on your account, across devices."),
    ]);
  }

  /*
   * Weekly accuracy: one series, so no legend — the heading names it. Bars
   * follow the house chart spec (dataviz): ≤24 px thick, 4 px rounded tip,
   * square at the baseline, a hairline at 50 %, and ONE direct label (the
   * latest week) rather than a number on every bar. Every value is also in
   * the text summary for screen readers and in the history list below.
   */
  function chart(series) {
    if (series.length < 2) return null;
    const W = 340, H = 120, padL = 30, padB = 18, padT = 16;
    const n = series.length, band = (W - padL) / n, bw = Math.min(24, band - 2);
    const y = (v) => padT + (1 - v) * (H - padT - padB);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "chart");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Correct picks by week: " +
      series.map((s) => `week ${s.week} ${s.correct} of ${s.total}`).join(", "));
    const add = (tag, attrs, text) => {
      const n2 = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [k, v] of Object.entries(attrs)) n2.setAttribute(k, v);
      if (text) n2.textContent = text;
      svg.append(n2); return n2;
    };
    for (const v of [0, 0.5, 1]) {
      add("line", { x1: padL, x2: W, y1: y(v), y2: y(v), class: "chart-grid" });
      add("text", { x: padL - 4, y: y(v) + 3, class: "chart-tick", "text-anchor": "end" }, `${v * 100}%`);
    }
    series.forEach((s, i) => {
      const v = s.total ? s.correct / s.total : 0;
      const x = padL + i * band + (band - bw) / 2, top = y(v), base = y(0), r = Math.min(4, (base - top) / 2);
      // Rounded tip, square base: a path, because rx would round the base too.
      const d = base - top < 1 ? `M${x},${base}h${bw}` :
        `M${x},${base}V${top + r}q0,-${r} ${r},-${r}h${bw - 2 * r}q${r},0 ${r},${r}V${base}Z`;
      const bar = add("path", { d, class: "chart-bar" });
      const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
      t.textContent = `Week ${s.week}: ${s.correct} of ${s.total}`;
      bar.append(t);
      if (n <= 10 || i % 2 === n % 2 - 1 || i === n - 1) {
        add("text", { x: x + bw / 2, y: H - 4, class: "chart-tick", "text-anchor": "middle" }, String(s.week));
      }
      if (i === n - 1) add("text", { x: x + bw / 2, y: top - 4, class: "chart-label", "text-anchor": "middle" }, `${s.correct}/${s.total}`);
    });
    return el("div", { class: "panel" }, [el("h2", { class: "panel-head" }, "Correct picks by week"), svg]);
  }

  function historySection() {
    const graded = Object.entries(ctx.state.picks)
      .filter(([, p]) => p.result)
      .sort(([, a], [, b]) => String(b.start_time).localeCompare(String(a.start_time)))
      .slice(0, 25);
    if (!graded.length) return null;
    return el("section", { class: "section" }, [
      el("h2", { class: "section-head" }, "Recent picks"),
      el("ul", { class: "history-list" }, graded.map(([id, p]) => el("li", { class: "history-row" }, [
        el("span", {}, `Wk ${p.week ?? "?"} · ${p.away} @ ${p.home}`),
        el("span", {}, `You picked ${p.pick === "home" ? p.home : p.pick === "away" ? p.away : "draw"}`),
        resultTag(p.result),
      ]))),
    ]);
  }

  return { render };
}

/* A result is never colour alone (tokens.css): glyph + word, always. */
export function resultTag(result) {
  if (result === "correct") return el("span", { class: "badge badge-good" }, "✓ Correct");
  if (result === "wrong") return el("span", { class: "badge badge-bad" }, "✗ Wrong");
  if (result === "void") return el("span", { class: "badge" }, "– Void");
  return null;
}

function pickBadge(p) {
  if (!p) return null;
  const who = p.pick === "home" ? p.home : p.pick === "away" ? p.away : "Draw";
  return el("span", { class: "event-pick" }, [`Your pick: ${who} `, resultTag(p.result)]);
}
