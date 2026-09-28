/* ============================================================================
 * Players — search any player, or browse a team's roster (docs/PLAN.md §5).
 * The profile itself is a sheet (details.js), so it can open from anywhere.
 * ========================================================================= */

import { el, mount, emptyState, loading, offlineState, badge } from "../dom.js";
import { getPublic } from "../api.js";

/* Search runs server-side on every keystroke after a pause. 250 ms is long
 * enough that typing "maho" is one request, short enough to feel live. */
const DEBOUNCE_MS = 250;

export function createPlayersView(ctx) {
  const root = document.getElementById("view-players");
  let built = false, timer = null, seq = 0;
  let input, teamSelect, results;

  function build() {
    input = el("input", {
      class: "input", type: "search", placeholder: "Search players", "aria-label": "Search players",
      autocomplete: "off", spellcheck: "false",
      oninput: () => { clearTimeout(timer); timer = setTimeout(search, DEBOUNCE_MS); },
    });
    teamSelect = el("select", { class: "input", "aria-label": "Filter by team", onchange: search },
      el("option", { value: "" }, "All teams"));
    results = el("div", { class: "card-list" });
    mount(root, ctx.banner(), el("div", { class: "search-row" }, [input, teamSelect]), results);
    built = true;
    fillTeams();
  }

  async function fillTeams() {
    const teams = await ctx.loadTeams();
    for (const t of teams) teamSelect.append(el("option", { value: t.id }, t.name));
  }

  async function search() {
    const my = ++seq;
    const q = input.value.trim();
    const team = teamSelect.value;
    if (q.length < 2 && !team) {
      return mount(results, emptyState("Find a player", "Type at least two letters of a name, or pick a team."));
    }
    mount(results, loading("Searching…"));
    const params = new URLSearchParams({ comp: ctx.primaryComp().id, limit: "40" });
    if (q.length >= 2) params.set("q", q);
    if (team) params.set("team", team);
    const r = await getPublic(`/v1/sb/players?${params}`);
    if (my !== seq) return;
    if (!r.data) return mount(results, offlineState(search));
    const players = r.data.players ?? [];
    mount(results, players.length ? players.map((p) => el("button", {
      class: "player-row", type: "button", onclick: () => ctx.openPlayer(p.id),
    }, [
      badge({ abbr: p.team_abbr, color: ctx.teamColors.get(p.team_id) }, "sm"),
      el("span", { class: "player-name" }, p.name),
      el("span", { class: "player-meta" }, `${p.position}${p.jersey ? ` · #${p.jersey}` : ""}`),
    ])) : emptyState("No players match", q ? `Nothing for “${q}”.` : "That team has no roster yet."));
  }

  return {
    render() {
      if (!built) build();
      search();
    },
  };
}
