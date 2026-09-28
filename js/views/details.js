/* ============================================================================
 * details.js — the three sheets that can open from any tab: a game (box
 * score), a player (profile + game log) and a team (last/next game, roster).
 * Each has a favourite star, so anything can be starred from wherever it is
 * seen.
 * ========================================================================= */

import { el, mount, eventCard, asOf, emptyState, loading, statTable, starButton, badge, fmtPts, statusText } from "../dom.js";
import { getPublic } from "../api.js";
import { isFavorite } from "../logic.js";

const PASSING = [
  { label: "C/ATT", get: (s) => `${s.pass_cmp ?? 0}/${s.pass_att ?? 0}` },
  { label: "YDS", get: (s) => String(s.pass_yds ?? 0) },
  { label: "TD", get: (s) => String(s.pass_td ?? 0) },
  { label: "INT", get: (s) => String(s.pass_int ?? 0) },
];
const RUSHING = [
  { label: "CAR", get: (s) => String(s.rush_att ?? 0) },
  { label: "YDS", get: (s) => String(s.rush_yds ?? 0) },
  { label: "TD", get: (s) => String(s.rush_td ?? 0) },
];
const RECEIVING = [
  { label: "REC", get: (s) => `${s.rec ?? 0}/${s.rec_tgt ?? 0}` },
  { label: "YDS", get: (s) => String(s.rec_yds ?? 0) },
  { label: "TD", get: (s) => String(s.rec_td ?? 0) },
];

function statGroup(title, lines, cols, has) {
  const rows = lines.filter((l) => has(l.stats ?? {}));
  if (!rows.length) return null;
  return el("div", {}, [
    el("h4", { class: "mini-head" }, title),
    statTable([{ label: "Player", get: (l) => l.name }, ...cols.map((c) => ({ label: c.label, get: (l) => c.get(l.stats ?? {}) })),
      { label: "FPTS", get: (l) => fmtPts(l.fantasy_pts) }], rows),
  ]);
}

export function createDetails(ctx) {
  function star(kind, id, label) {
    return starButton({
      on: isFavorite(ctx.state.favorites, kind, id),
      label,
      onToggle: () => ctx.toggleFavorite(kind, id),
    });
  }

  async function openEvent(id) {
    const body = el("div", {}, loading());
    ctx.openDetail("Game", body);
    const r = await getPublic(`/v1/sb/event?id=${encodeURIComponent(id)}`);
    if (!r.data?.event) return mount(body, emptyState("Couldn't load this game", "Try again when you're back online."));
    const { event, box = [] } = r.data;
    ctx.setDetailTitle(`${event.away.abbr} @ ${event.home.abbr}`);
    const teamName = (tid) => (tid === event.home.team_id ? event.home : event.away);
    mount(body,
      el("div", { class: "detail-actions" }, [star("events", event.id, "this game"),
        el("span", { class: "fine" }, `${event.week ? `Week ${event.week} · ` : ""}${event.venue ?? ""}`)]),
      eventCard(event, {}),
      asOf(r.data, r.stale),
      box.length ? box.map((team) => {
        const side = teamName(team.team_id);
        const lines = team.players ?? [];
        return el("section", { class: "section" }, [
          el("h3", { class: "sub-head" }, [badge(side, "sm"), ` ${side.name}`]),
          statGroup("Passing", lines, PASSING, (s) => (s.pass_att ?? 0) > 0),
          statGroup("Rushing", lines, RUSHING, (s) => (s.rush_att ?? 0) > 0),
          statGroup("Receiving", lines, RECEIVING, (s) => (s.rec_tgt ?? 0) > 0 || (s.rec ?? 0) > 0),
        ]);
      }) : el("p", { class: "fine" }, event.status === "scheduled"
        ? `Kickoff ${statusText(event)}. The box score fills in once the game starts.`
        : "No box score for this game."),
    );
    // Tapping a name in a box score opens the player. Delegated so the
    // stat tables stay plain markup.
    body.querySelectorAll(".stat-table tbody th").forEach((th, i) => {
      const all = box.flatMap((t) => t.players ?? []);
      const line = all.find((l) => l.name === th.textContent);
      if (!line) return;
      th.classList.add("linkish");
      th.tabIndex = 0;
      th.addEventListener("click", () => openPlayer(line.player_id));
      th.addEventListener("keydown", (e) => { if (e.key === "Enter") openPlayer(line.player_id); });
    });
  }

  async function openPlayer(id) {
    const body = el("div", {}, loading());
    ctx.openDetail("Player", body);
    const r = await getPublic(`/v1/sb/player?id=${encodeURIComponent(id)}`);
    if (!r.data?.player) return mount(body, emptyState("Couldn't load this player", "Try again when you're back online."));
    const { player, season, gamelog = [] } = r.data;
    ctx.setDetailTitle(player.name);
    const t = season?.totals ?? {};
    const pos = player.position;
    const lines = pos === "QB"
      ? [["Pass yds", t.pass_yds], ["Pass TD", t.pass_td], ["INT", t.pass_int], ["Rush yds", t.rush_yds]]
      : pos === "RB"
        ? [["Rush yds", t.rush_yds], ["Rush TD", t.rush_td], ["Rec", t.rec], ["Rec yds", t.rec_yds]]
        : [["Rec", t.rec], ["Rec yds", t.rec_yds], ["Rec TD", t.rec_td], ["Targets", t.rec_tgt]];
    const tile = (label, value) => el("div", { class: "stat-tile" }, [
      el("span", { class: "stat-value" }, value ?? "0"), el("span", { class: "stat-label" }, label)]);

    mount(body,
      el("div", { class: "detail-actions" }, [star("players", player.id, player.name),
        el("button", { class: "linkish", type: "button", onclick: () => openTeam(player.team_id) },
          `${pos}${player.jersey ? ` · #${player.jersey}` : ""} · ${player.team_abbr}`)]),
      asOf(r.data, r.stale),
      el("div", { class: "panel" }, [
        el("h3", { class: "panel-head" }, `${season?.season ?? ""} season · ${season?.games ?? 0} games`),
        el("div", { class: "stat-row" }, [
          ...lines.map(([l, v]) => tile(l, String(v ?? 0))),
          tile("Fantasy / game", fmtPts(season?.fantasy_ppg)),
        ]),
      ]),
      el("h3", { class: "sub-head" }, "Game log"),
      gamelog.length ? statTable([
        { label: "Wk", get: (g) => String(g.week ?? "") },
        { label: "Opp", get: (g) => `${g.home ? "vs" : "@"} ${g.opponent_abbr}` },
        { label: "Result", get: (g) => g.result ?? "" },
        { label: pos === "QB" ? "Pass" : pos === "RB" ? "Rush" : "Rec", get: (g) => pos === "QB"
          ? `${g.stats.pass_yds ?? 0} yds ${g.stats.pass_td ?? 0} TD`
          : pos === "RB" ? `${g.stats.rush_yds ?? 0} yds ${g.stats.rush_td ?? 0} TD`
            : `${g.stats.rec ?? 0}-${g.stats.rec_yds ?? 0} ${g.stats.rec_td ?? 0} TD` },
        { label: "FPTS", get: (g) => fmtPts(g.fantasy_pts) },
      ], gamelog) : emptyState("No games yet this season"),
    );
  }

  async function openTeam(id) {
    const body = el("div", {}, loading());
    ctx.openDetail("Team", body);
    const r = await getPublic(`/v1/sb/team?id=${encodeURIComponent(id)}`);
    if (!r.data?.team) return mount(body, emptyState("Couldn't load this team", "Try again when you're back online."));
    const { team, last, next, roster = [] } = r.data;
    ctx.setDetailTitle(team.name);
    const order = ["QB", "RB", "WR", "TE"];
    const sorted = [...roster].sort((a, b) => (order.indexOf(a.position) + 1 || 9) - (order.indexOf(b.position) + 1 || 9) || a.name.localeCompare(b.name));
    mount(body,
      el("div", { class: "detail-actions" }, [star("teams", team.id, team.name), badge(team), el("span", { class: "fine" }, team.record ?? "")]),
      last ? el("div", {}, [el("h3", { class: "sub-head" }, "Last game"), eventCard(last, { onOpen: (e) => openEvent(e.id) })]) : null,
      next ? el("div", {}, [el("h3", { class: "sub-head" }, "Next game"), eventCard(next, { onOpen: (e) => openEvent(e.id) })]) : null,
      el("h3", { class: "sub-head" }, "Roster"),
      sorted.length ? el("div", { class: "card-list" }, sorted.map((p) => el("button", {
        class: "player-row", type: "button", onclick: () => openPlayer(p.id),
      }, [el("span", { class: "player-name" }, p.name), el("span", { class: "player-meta" }, `${p.position}${p.jersey ? ` · #${p.jersey}` : ""}`)])))
        : emptyState("No roster yet"),
    );
  }

  return { openEvent, openPlayer, openTeam };
}
