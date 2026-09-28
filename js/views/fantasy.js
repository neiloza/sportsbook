/* ============================================================================
 * Fantasy — the free squad game (budget style) and premium mini-leagues.
 *
 * The squad game is FREE and needs no account (decided 2026-09-28): you
 * play under an anonymous handle, against yourself week to week and against
 * everyone on the global leaderboard. The SERVER validates and scores every
 * lineup; this screen is a builder and a scoreboard.
 *
 * NFL rules (docs/API.md "Squad game"): QB, 2 RB, 3 WR, TE, FLEX; budget
 * 100.0; max 3 from one team; a captain scores double; the whole lineup
 * locks at the kickoff of the week's first game.
 *
 * Classic snake-draft NFL leagues are Phase 6 and are not built yet; the
 * tab says so rather than hiding it.
 * ========================================================================= */

import { el, mount, emptyState, loading, offlineState, segmented, fmtPts, badge } from "../dom.js";
import { getPublic, callPrivate } from "../api.js";
import {
  SLOT_ORDER, slotAccepts, lineupToApi, lineupFromApi, lineupCost, whyNot, kickoffLabel,
} from "../logic.js";
import { leaguesPanel } from "./leagues.js";

export function createFantasyView(ctx) {
  const root = document.getElementById("view-fantasy");
  let seq = 0;
  let pool = null;              // last /squad/pool answer
  let draft = null;             // { week, slots: [id|null ×8], captain } being edited
  let saved = null;             // the server's entry for this week

  const handle = () => ctx.state.squad.handle;
  const comp = () => ctx.primaryComp();

  async function render() {
    const my = ++seq;
    const mode = ctx.state.settings.fantasyMode === "leagues" ? "leagues" : "squad";
    const body = el("div", {}, loading());
    mount(root, ctx.banner(), segmented(
      [["squad", "Squad game"], ["leagues", "Leagues"]], mode,
      (v) => { ctx.state.settings.fantasyMode = v; ctx.persist(); render(); }, "Fantasy section"), body);
    if (mode === "leagues") return mount(body, leaguesPanel(ctx, { kind: "squad", comp: comp().id, title: "Mini-leagues" }), draftLeaguesNote());
    await renderSquad(body, my);
  }

  function draftLeaguesNote() {
    return el("div", { class: "panel" }, [
      el("p", { class: "panel-head" }, "Draft leagues"),
      el("p", { class: "panel-sub" }, "Season-long NFL leagues with a live snake draft are coming next. Mini-leagues use the squad game in the meantime."),
    ]);
  }

  async function renderSquad(body, my) {
    const c = comp();
    const p = await getPublic(`/v1/sb/squad/pool?comp=${encodeURIComponent(c.id)}`);
    if (my !== seq) return;
    if (!p.data) return mount(body, offlineState(render));
    pool = p.data;

    if (handle()) {
      try {
        const r = await callPrivate(`/v1/sb/squad/entry?comp=${encodeURIComponent(c.id)}&week=${pool.week}`,
          { handleToken: handle().token });
        saved = r.entry;
      } catch (ex) {
        saved = null;
        if (ex.status === 401) {
          // The server no longer knows this handle (a reset database, a
          // mistyped restore). Drop it so the user can make a new one,
          // rather than failing every save with no explanation.
          ctx.state.squad.handle = null;
          ctx.persist();
          ctx.toast("Your squad name was not recognised. Pick a new one to keep playing.");
        }
      }
      if (my !== seq) return;
    } else saved = null;

    if (!draft || draft.week !== pool.week) {
      draft = saved
        ? { week: pool.week, slots: lineupFromApi(saved.lineup), captain: saved.captain }
        : { week: pool.week, slots: SLOT_ORDER.map(() => null), captain: null };
    }

    const board = el("div", {}, loading());
    mount(body,
      header(),
      pool.locked ? lockedLineup() : builder(),
      el("section", { class: "section" }, [el("h2", { class: "section-head" }, "Leaderboard"), board]),
    );
    renderBoard(board, "week");
  }

  function header() {
    const who = handle();
    return el("div", { class: "panel squad-head" }, [
      el("div", { class: "squad-title" }, [
        el("h2", { class: "panel-head" }, `Week ${pool.week} squad`),
        el("span", { class: "fine" }, pool.locked ? "Locked — scoring live" : `Locks ${kickoffLabel(pool.deadline)}`),
      ]),
      el("p", { class: "panel-sub" }, who
        ? `Playing as ${who.nickname}`
        : "Pick 8 players under 100.0. Your captain scores double. No account needed."),
    ]);
  }

  /* --- the builder ------------------------------------------------------ */

  function playerById(id) {
    return pool.players.find((pl) => pl.id === id) ?? null;
  }

  function builder() {
    const cost = lineupCost(draft.slots, (id) => playerById(id)?.price);
    const left = Math.round((pool.budget - cost) * 10) / 10;
    const full = draft.slots.every(Boolean);
    const dirty = !saved || JSON.stringify(lineupToApi(draft.slots)) !== JSON.stringify(normalised(saved.lineup)) || draft.captain !== saved.captain;

    return el("section", { class: "section" }, [
      el("div", { class: "budget-bar", role: "status" }, [
        el("span", {}, `Budget left ${left.toFixed(1)}`),
        el("div", { class: "meter", "aria-hidden": "true" },
          el("span", { style: { width: `${Math.max(0, Math.min(100, (cost / pool.budget) * 100))}%` }, class: left < 0 ? "over" : "" })),
      ]),
      el("div", { class: "slot-list" }, SLOT_ORDER.map((slot, i) => slotRow(slot, i))),
      el("div", { class: "btn-row" }, [
        el("button", {
          class: "btn btn-primary", type: "button",
          disabled: !full || !draft.captain || !dirty,
          onclick: save,
        }, saved && !dirty ? "Saved ✓" : "Save lineup"),
        !full ? el("span", { class: "fine" }, `${draft.slots.filter(Boolean).length}/8 picked`) :
          !draft.captain ? el("span", { class: "fine" }, "Tap C to choose a captain") : null,
      ]),
    ]);
  }

  function normalised(lineup) {
    return lineupToApi(lineupFromApi(lineup));
  }

  function slotRow(slot, i) {
    const id = draft.slots[i];
    const pl = id ? playerById(id) : null;
    const isCap = !!id && draft.captain === id;
    return el("div", { class: `slot-row${pl ? " filled" : ""}` }, [
      el("span", { class: "slot-pos" }, slot),
      el("button", { class: "slot-pick", type: "button", onclick: () => openPicker(i) }, pl
        ? [badge({ abbr: pl.team_abbr, color: teamColor(pl.team_id) }, "sm"),
          el("span", { class: "slot-name" }, pl.name),
          el("span", { class: "slot-meta" }, `${pl.position} · ${pl.home ? "vs" : "@"} ${pl.opponent_abbr ?? "BYE"}`)]
        : el("span", { class: "slot-empty" }, `Add ${slot === "FLEX" ? "RB / WR / TE" : slot}`)),
      pl ? el("span", { class: "slot-price" }, pl.price.toFixed(1)) : null,
      pl ? el("button", {
        class: `cap-btn${isCap ? " on" : ""}`, type: "button",
        "aria-pressed": isCap ? "true" : "false",
        "aria-label": `Make ${pl.name} captain`,
        onclick: () => { draft.captain = id; rerenderBuilder(); },
      }, "C") : null,
      pl ? el("button", {
        class: "icon-btn sm", type: "button", "aria-label": `Remove ${pl.name}`,
        onclick: () => {
          draft.slots[i] = null;
          if (draft.captain === id) draft.captain = null;
          rerenderBuilder();
        },
      }, "✕") : null,
    ]);
  }

  function teamColor(teamId) {
    return ctx.teamColors.get(teamId) ?? null;
  }

  function rerenderBuilder() {
    const old = root.querySelector(".section .slot-list")?.closest(".section");
    if (old) old.replaceWith(builder());
  }

  function openPicker(slotIndex) {
    const slot = SLOT_ORDER[slotIndex];
    const search = el("input", { class: "input", type: "search", placeholder: "Search players", "aria-label": "Search players" });
    const list = el("div", { class: "picker-list" });
    const draw = () => {
      const qv = search.value.trim().toLowerCase();
      const options = pool.players
        .filter((pl) => slotAccepts(slot, pl.position))
        .filter((pl) => !qv || pl.name.toLowerCase().includes(qv) || pl.team_abbr.toLowerCase() === qv)
        .sort((a, b) => b.price - a.price)
        .slice(0, 80);
      mount(list, options.length ? options.map((pl) => {
        const reason = whyNot({ slots: draft.slots, slotIndex, player: pl, budget: pool.budget, maxPerTeam: pool.max_per_team, playerById });
        return el("button", {
          class: "picker-row", type: "button", disabled: !!reason,
          onclick: () => {
            const prev = draft.slots[slotIndex];
            draft.slots[slotIndex] = pl.id;
            if (draft.captain === prev) draft.captain = null;
            ctx.closeDetail();
            rerenderBuilder();
          },
        }, [
          badge({ abbr: pl.team_abbr, color: teamColor(pl.team_id) }, "sm"),
          el("span", { class: "picker-name" }, [pl.name, el("span", { class: "fine" }, ` ${pl.position} · ${pl.home ? "vs" : "@"} ${pl.opponent_abbr ?? "BYE"}${reason ? ` · ${reason}` : ""}`)]),
          el("span", { class: "slot-price" }, pl.price.toFixed(1)),
        ]);
      }) : emptyState("No players match"));
    };
    search.addEventListener("input", draw);
    draw();
    ctx.openDetail(`Pick a ${slot === "FLEX" ? "FLEX (RB/WR/TE)" : slot}`, el("div", {}, [search, list]));
  }

  async function save() {
    let h = handle();
    if (!h) h = await askForHandle();
    if (!h) return;
    try {
      const r = await callPrivate("/v1/sb/squad/entry", {
        method: "POST", handleToken: h.token,
        body: { comp: comp().id, week: pool.week, lineup: lineupToApi(draft.slots), captain: draft.captain },
      });
      saved = r.entry;
      ctx.toast("Lineup saved.");
      render();
    } catch (ex) {
      if (ex.status === 409) { ctx.toast("This week has locked."); render(); }
      else ctx.toast(ex.message);
    }
  }

  /** The anonymous identity. Returns the handle or null if the user backed
   *  out. The token comes back once, so it goes straight into the store. */
  function askForHandle() {
    return new Promise((resolve) => {
      const input = el("input", { class: "input", type: "text", maxlength: 20, placeholder: "Your squad name", "aria-label": "Squad name" });
      const err = el("p", { class: "form-error", role: "alert" });
      let done = false;
      const form = el("form", {
        class: "form",
        onsubmit: async (e) => {
          e.preventDefault();
          const nickname = input.value.trim();
          if (!/^[A-Za-z0-9 _.-]{2,20}$/.test(nickname)) { err.textContent = "2–20 letters, numbers, spaces, _ - or ."; return; }
          try {
            const r = await callPrivate("/v1/sb/handles", { method: "POST", body: { nickname } });
            ctx.state.squad.handle = { id: r.handle.id, nickname: r.handle.nickname, token: r.token };
            ctx.persist();
            done = true;
            ctx.closeDetail();
            // Signed in? Link the handle so mini-leagues can find its points.
            if (ctx.account.signedIn()) {
              callPrivate("/v1/sb/handles/claim", { method: "POST", handleToken: r.token }).catch(() => {});
            }
            resolve(ctx.state.squad.handle);
          } catch (ex) { err.textContent = ex.message; }
        },
      }, [
        el("p", { class: "panel-sub" }, "This is the name on the leaderboard. No account needed — it's saved on this phone and in Download backup."),
        input, err, el("button", { class: "btn btn-primary", type: "submit" }, "Save and play"),
      ]);
      ctx.openDetail("Name your squad", form, () => { if (!done) resolve(null); });
      setTimeout(() => input.focus(), 50);
    });
  }

  /* --- after the lock ---------------------------------------------------- */

  function lockedLineup() {
    if (!saved) {
      return el("div", { class: "panel" }, emptyState("You sat this week out", "Next week's squad opens once this week's games finish."));
    }
    const pts = new Map((saved.breakdown ?? []).map((b) => [b.player_id, b]));
    return el("section", { class: "section" }, [
      el("div", { class: "panel total-card" }, [
        el("span", { class: "stat-value" }, fmtPts(saved.points)),
        el("span", { class: "stat-label" }, "points this week"),
      ]),
      el("div", { class: "slot-list" }, lineupFromApi(saved.lineup).map((id, i) => {
        const pl = playerById(id);
        const b = pts.get(id);
        return el("div", { class: "slot-row filled" }, [
          el("span", { class: "slot-pos" }, SLOT_ORDER[i]),
          el("span", { class: "slot-pick static" }, [
            el("span", { class: "slot-name" }, `${pl?.name ?? "Player"}${saved.captain === id ? " (C)" : ""}`),
            el("span", { class: "slot-meta" }, pl ? `${pl.position} · ${pl.team_abbr}` : ""),
          ]),
          el("span", { class: "slot-price" }, fmtPts(b?.pts)),
        ]);
      })),
    ]);
  }

  async function renderBoard(box, scope) {
    const q = scope === "week" ? `&week=${pool.week}` : "";
    const r = await getPublic(`/v1/sb/squad/leaderboard?comp=${encodeURIComponent(comp().id)}${q}`);
    const tabs = segmented([["week", `Week ${pool.week}`], ["season", "Season"]], scope, (v) => renderBoard(box, v), "Leaderboard period");
    if (!r.data) return mount(box, tabs, offlineState(() => renderBoard(box, scope)));
    const me = handle()?.id;
    const rows = r.data.rows ?? [];
    mount(box, tabs, rows.length
      ? el("ol", { class: "board" }, rows.map((row) => el("li", { class: `board-row${row.handle_id === me ? " me" : ""}` }, [
        el("span", { class: "board-rank" }, String(row.rank)),
        el("span", { class: "board-name" }, row.nickname),
        el("span", { class: "board-pts" }, fmtPts(row.points)),
      ])))
      : emptyState(pool.locked ? "No scores yet" : "Scores appear once the week locks",
        "Everyone's lineups stay hidden until kickoff."));
  }

  return { render };
}
