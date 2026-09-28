/* ============================================================================
 * Favorites — the centre tab and the one the app opens on. Everything the
 * user starred, rolled into one feed: each favourite team's live / next /
 * last game, each favourite player's latest line, starred games, and
 * headlines from favourite sports.
 *
 * A brand-new user has starred nothing, so the empty state IS the
 * onboarding: pick your teams right here, no separate flow to get lost in.
 * Favourites live on the device for everyone; Premium syncs them.
 * ========================================================================= */

import { el, mount, eventCard, emptyState, loading, badge, fmtPts } from "../dom.js";
import { getPublic } from "../api.js";
import { favoriteIds, isFavorite } from "../logic.js";

export function createFavoritesView(ctx) {
  const root = document.getElementById("view-favorites");
  let seq = 0;
  let editing = false;

  async function render() {
    const my = ++seq;
    const f = ctx.state.favorites;
    const teams = favoriteIds(f, "teams"), players = favoriteIds(f, "players"),
      events = favoriteIds(f, "events"), comps = favoriteIds(f, "comps");
    const nothing = !teams.length && !players.length && !events.length && !comps.length;

    if (nothing || editing) return renderPicker(my, nothing);

    const sections = el("div", {}, loading());
    mount(root, ctx.banner(),
      el("div", { class: "view-head" }, [
        el("h2", { class: "view-title" }, "Your favorites"),
        el("button", { class: "btn btn-ghost", type: "button", onclick: () => { editing = true; render(); } }, "Edit"),
      ]),
      sections);

    const [teamData, playerData, eventData, newsData] = await Promise.all([
      Promise.all(teams.map((id) => getPublic(`/v1/sb/team?id=${encodeURIComponent(id)}`))),
      Promise.all(players.map((id) => getPublic(`/v1/sb/player?id=${encodeURIComponent(id)}`))),
      Promise.all(events.map((id) => getPublic(`/v1/sb/event?id=${encodeURIComponent(id)}`))),
      Promise.all(comps.map((id) => getPublic(`/v1/sb/news?comp=${encodeURIComponent(id)}&limit=3`))),
    ]);
    if (my !== seq) return;

    const out = [];
    if (teams.length) out.push(section("Your teams", teamData.map((r, i) => r.data?.team ? teamCard(r.data) : missing(teams[i], "team"))));
    if (players.length) out.push(section("Your players", playerData.map((r, i) => r.data?.player ? playerCard(r.data) : missing(players[i], "player"))));
    if (events.length) {
      out.push(section("Starred games", eventData.map((r, i) => r.data?.event
        ? eventCard(r.data.event, { onOpen: (e) => ctx.openEvent(e.id) }) : missing(events[i], "game"))));
    }
    const items = newsData.flatMap((r) => r.data?.items ?? []);
    if (items.length) {
      out.push(section("From your sports", items.map((n) => el("a", {
        class: "headline", href: n.url, target: "_blank", rel: "noopener noreferrer",
      }, [el("span", { class: "headline-title" }, n.title), el("span", { class: "headline-meta" }, n.source ?? "")]))));
    }
    if (!ctx.isPremium()) {
      out.push(el("p", { class: "fine center" }, "Favorites are saved on this phone. Premium keeps them on your account, on every device."));
    }
    mount(sections, out);
  }

  function section(title, kids) {
    return el("section", { class: "section" }, [el("h2", { class: "section-head" }, title), el("div", { class: "card-list" }, kids)]);
  }

  /* A favourite the server no longer knows (a player cut, a demo reset)
   * still shows, so it can be un-starred, instead of silently vanishing. */
  function missing(id, what) {
    return el("div", { class: "panel fine" }, [`This ${what} isn't available right now. `,
      el("button", { class: "linkish", type: "button", onclick: () => { ctx.toggleFavorite(kindOf(what), id); render(); } }, "Remove")]);
  }

  function kindOf(what) {
    return what === "team" ? "teams" : what === "player" ? "players" : "events";
  }

  function teamCard({ team, last, next }) {
    const live = [last, next].find((e) => e?.status === "live");
    const games = live ? [live] : [next, last].filter(Boolean);
    return el("div", { class: "fav-team" }, [
      el("button", { class: "fav-team-head", type: "button", onclick: () => ctx.openTeam(team.id) }, [
        badge(team), el("span", { class: "fav-team-name" }, team.name), el("span", { class: "fine" }, team.record ?? ""),
      ]),
      ...games.map((e) => eventCard(e, { onOpen: (ev) => ctx.openEvent(ev.id) })),
    ]);
  }

  function playerCard({ player, season, gamelog = [] }) {
    const g = gamelog[0];
    return el("button", { class: "player-row", type: "button", onclick: () => ctx.openPlayer(player.id) }, [
      badge({ abbr: player.team_abbr, color: ctx.teamColors.get(player.team_id) }, "sm"),
      el("span", { class: "player-name" }, [player.name, el("span", { class: "fine" }, ` ${player.position}`)]),
      el("span", { class: "player-meta" }, g
        ? `Wk ${g.week} ${g.result ?? ""} · ${fmtPts(g.fantasy_pts)} pts`
        : `${fmtPts(season?.fantasy_ppg)} pts/g`),
    ]);
  }

  /* --- onboarding / edit -------------------------------------------------- */

  async function renderPicker(my, firstTime) {
    const grid = el("div", { class: "team-grid" }, loading());
    mount(root, ctx.banner(),
      el("div", { class: "view-head" }, [
        el("h2", { class: "view-title" }, firstTime ? "Pick your teams" : "Edit favorites"),
        firstTime ? null : el("button", { class: "btn btn-primary", type: "button", onclick: () => { editing = false; render(); } }, "Done"),
      ]),
      el("p", { class: "section-sub" }, firstTime
        ? "Star the teams you follow and they'll lead this screen. You can star players and games anywhere in the app."
        : "Tap to star or un-star."),
      compChips(),
      grid);
    const teams = await ctx.loadTeams();
    if (my !== seq) return;
    if (!teams.length) return mount(grid, emptyState("Teams will appear once Sportsbook is reachable"));
    mount(grid, teams.map((t) => teamToggle(t)));
    if (firstTime) {
      root.append(el("div", { class: "btn-row center" },
        el("button", { class: "btn btn-primary", type: "button", onclick: () => render() }, "Show my favorites")));
    }
  }

  function compChips() {
    const enabled = ctx.comps.filter((c) => c.enabled);
    return el("div", { class: "chip-row", role: "group", "aria-label": "Favorite sports" }, enabled.map((c) => {
      const on = isFavorite(ctx.state.favorites, "comps", c.id);
      return el("button", {
        class: `chip${on ? " active" : ""}`, type: "button", "aria-pressed": on ? "true" : "false",
        onclick: (e) => {
          const now = ctx.toggleFavorite("comps", c.id);
          e.currentTarget.classList.toggle("active", now);
          e.currentTarget.setAttribute("aria-pressed", now ? "true" : "false");
        },
      }, `${c.emoji} ${c.name}`);
    }));
  }

  function teamToggle(t) {
    const on = isFavorite(ctx.state.favorites, "teams", t.id);
    const b = el("button", {
      class: `team-toggle${on ? " on" : ""}`, type: "button", "aria-pressed": on ? "true" : "false",
      onclick: () => {
        const now = ctx.toggleFavorite("teams", t.id);
        b.classList.toggle("on", now);
        b.setAttribute("aria-pressed", now ? "true" : "false");
      },
    }, [badge(t), el("span", { class: "team-toggle-name" }, t.short || t.name), el("span", { class: "team-toggle-star", "aria-hidden": "true" }, "★")]);
    return b;
  }

  return { render, leave: () => { editing = false; } };
}
