/* ============================================================================
 * News — what is happening NOW: today's scores and the latest headlines,
 * filterable by competition (docs/PLAN.md §5).
 * ========================================================================= */

import { el, mount, eventCard, asOf, emptyState, loading, offlineState } from "../dom.js";
import { getPublic } from "../api.js";

/* While a game is live the scores refresh every 30 s — but only while this
 * view is on screen and the page is visible. A background tab polling an API
 * all Sunday is battery and data nobody asked to spend. */
const LIVE_REFRESH_MS = 30_000;

export function createNewsView(ctx) {
  const root = document.getElementById("view-news");
  let timer = null;
  let seq = 0;

  function comps() {
    return ctx.comps.filter((c) => c.enabled);
  }

  function chips(active) {
    const all = [["all", "All"], ...comps().map((c) => [c.id, `${c.emoji} ${c.short}`])];
    return el("div", { class: "chip-row", role: "group", "aria-label": "Filter by sport" },
      all.map(([id, label]) => el("button", {
        class: `chip${id === active ? " active" : ""}`,
        type: "button",
        "aria-pressed": id === active ? "true" : "false",
        onclick: () => { ctx.state.settings.newsComp = id; ctx.persist(); render(); },
      }, label)));
  }

  function headline(item) {
    // Opens the source site, which the user chose to do. rel=noopener so the
    // publisher's page cannot reach back into this one.
    return el("a", {
      class: "headline", href: item.url, target: "_blank", rel: "noopener noreferrer",
    }, [
      el("span", { class: "headline-title" }, item.title),
      item.summary ? el("span", { class: "headline-summary" }, item.summary) : null,
      el("span", { class: "headline-meta" }, [
        item.source ?? "", item.published_at ? ` · ${ago(item.published_at)}` : "",
      ]),
    ]);
  }

  async function render() {
    const my = ++seq;
    clearTimeout(timer);
    const active = comps().some((c) => c.id === ctx.state.settings.newsComp)
      ? ctx.state.settings.newsComp : "all";
    const targets = active === "all" ? comps() : comps().filter((c) => c.id === active);

    const scores = el("section", { class: "section", "aria-labelledby": "news-scores-h" },
      [el("h2", { class: "section-head", id: "news-scores-h" }, "Scores"), loading()]);
    const news = el("section", { class: "section", "aria-labelledby": "news-head-h" },
      [el("h2", { class: "section-head", id: "news-head-h" }, "Headlines"), loading()]);
    mount(root, ctx.banner(), chips(active), scores, news);

    const [boards, feed] = await Promise.all([
      Promise.all(targets.map((c) => getPublic(`/v1/sb/scoreboard?comp=${encodeURIComponent(c.id)}`)
        .then((r) => ({ comp: c, ...r })))),
      getPublic(`/v1/sb/news?comp=${encodeURIComponent(active)}&limit=30`),
    ]);
    if (my !== seq) return;   // a newer render started while this one waited

    let anyLive = false;
    const scoreKids = [el("h2", { class: "section-head", id: "news-scores-h" }, "Scores")];
    for (const b of boards) {
      if (!b.data) { scoreKids.push(offlineState(render)); continue; }
      const events = [...(b.data.events ?? [])].sort(byLiveThenTime);
      anyLive ||= events.some((e) => e.status === "live");
      if (boards.length > 1) scoreKids.push(el("h3", { class: "sub-head" }, `${b.comp.emoji} ${b.comp.name}`));
      scoreKids.push(asOf(b.data, b.stale));
      if (!events.length) scoreKids.push(emptyState("No games today", "Scores show here on game days."));
      else scoreKids.push(el("div", { class: "card-list" }, events.map((e) => eventCard(e, { onOpen: (ev) => ctx.openEvent(ev.id) }))));
    }
    mount(scores, scoreKids);

    const newsKids = [el("h2", { class: "section-head", id: "news-head-h" }, "Headlines")];
    if (!feed.data) newsKids.push(offlineState(render));
    else if (!feed.data.items?.length) newsKids.push(emptyState("No headlines yet"));
    else newsKids.push(asOf(feed.data, feed.stale), el("div", { class: "headline-list" }, feed.data.items.map(headline)));
    mount(news, newsKids);

    if (anyLive && ctx.isActive("news")) timer = setTimeout(() => {
      if (document.visibilityState === "visible" && ctx.isActive("news")) render();
    }, LIVE_REFRESH_MS);
  }

  return { render, leave: () => clearTimeout(timer) };
}

function byLiveThenTime(a, b) {
  const rank = (e) => (e.status === "live" ? 0 : e.status === "scheduled" ? 1 : 2);
  return rank(a) - rank(b) || String(a.start_time).localeCompare(String(b.start_time));
}

function ago(iso) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}
