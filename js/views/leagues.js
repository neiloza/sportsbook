/* ============================================================================
 * leagues.js — premium leagues with friends: create, invite, join, standings.
 *
 * Shared by the Scorecard (pick'em leagues) and Fantasy (squad-game
 * mini-leagues) tabs. Leagues are premium-only (decided 2026-09-28): a
 * league needs a signed-in account because membership is shared server data,
 * and it needs the unlock because leagues are the feature with real ongoing
 * cost. The server enforces both (401/402); this file only decides what to
 * OFFER, so a stale entitlement cache costs a confusing button, never access.
 *
 * "Nearby devices" (docs/PLAN.md §6): the web cannot discover phones around
 * it, so an invite goes out three ways, in order of convenience — the phone's
 * own share sheet (which includes AirDrop / Quick Share), a QR code for the
 * friend's camera, and the six-character code, which always works.
 * ========================================================================= */

import { el, mount, emptyState, loading, statTable } from "../dom.js";
import { callPrivate } from "../api.js";
import { normaliseCode } from "../logic.js";

const APP_URL = "https://sportsbook.thewizardofoza.com/";

export function inviteUrl(code) {
  return `${APP_URL}?join=${encodeURIComponent(code)}`;
}

export function leaguesPanel(ctx, { kind, comp, title }) {
  const section = el("section", { class: "section" }, [el("h2", { class: "section-head" }, title)]);

  if (!ctx.isPremium()) {
    section.append(el("div", { class: "panel upsell" }, [
      el("p", { class: "panel-head" }, "Play against your friends"),
      el("p", { class: "panel-sub" }, kind === "pickem"
        ? "Private pick'em leagues with a shared leaderboard. Picks lock at kickoff for everyone."
        : "Private mini-leagues for the squad game: your friends, your leaderboard."),
      el("button", { class: "btn btn-primary", type: "button", onclick: () => ctx.requirePremium("Leagues") },
        "Get Premium — $5 once"),
    ]));
    return section;
  }

  const list = el("div", { class: "card-list" }, loading());
  section.append(list, el("div", { class: "btn-row" }, [
    el("button", { class: "btn btn-primary", type: "button", onclick: () => openCreate(ctx, { kind, comp }) }, "Create league"),
    el("button", { class: "btn", type: "button", onclick: () => openJoin(ctx) }, "Join with code"),
  ]));

  ctx.loadLeagues().then(() => {
    const mine = ctx.leagues.filter((l) => l.kind === kind && l.comp === comp);
    mount(list, mine.length
      ? mine.map((l) => el("button", { class: "league-row", type: "button", onclick: () => openLeague(ctx, l.id) }, [
        el("span", { class: "league-name" }, l.name),
        el("span", { class: "league-meta" }, `${l.members} member${l.members === 1 ? "" : "s"}${l.role === "owner" ? " · you run it" : ""}`),
      ]))
      : emptyState("No leagues yet", "Create one and invite friends, or join with a code."));
  }).catch((err) => mount(list, emptyState("Couldn't load your leagues", err.message)));

  return section;
}

/* --- create / join ------------------------------------------------------- */

export function openCreate(ctx, { kind, comp }) {
  const input = el("input", { class: "input", type: "text", maxlength: 40, placeholder: "League name", "aria-label": "League name" });
  const err = el("p", { class: "form-error", role: "alert" });
  const submit = el("button", { class: "btn btn-primary", type: "submit" }, "Create");
  const form = el("form", {
    class: "form",
    onsubmit: async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (name.length < 2) { err.textContent = "Give it a name of at least 2 characters."; return; }
      submit.disabled = true;
      try {
        const { league } = await callPrivate("/v1/sb/leagues", { method: "POST", body: { name, kind, comp } });
        await ctx.loadLeagues(true);
        openLeague(ctx, league.id);
        ctx.refreshActive();
      } catch (ex) {
        if (ex.status === 402 || ex.status === 401) return ctx.requirePremium("Leagues");
        err.textContent = ex.message;
      } finally { submit.disabled = false; }
    },
  }, [
    el("p", { class: "panel-sub" }, kind === "pickem" ? "A pick'em league for every game this season." : "A private leaderboard for the squad game."),
    input, err, submit,
  ]);
  ctx.openDetail(kind === "pickem" ? "New pick'em league" : "New mini-league", form);
  setTimeout(() => input.focus(), 50);
}

export function openJoin(ctx, prefill = "") {
  const input = el("input", {
    class: "input code-input", type: "text", maxlength: 9, value: prefill,
    autocapitalize: "characters", autocomplete: "off", spellcheck: "false",
    placeholder: "ABC123", "aria-label": "Invite code",
  });
  const err = el("p", { class: "form-error", role: "alert" });
  const submit = el("button", { class: "btn btn-primary", type: "submit" }, "Join");
  const form = el("form", {
    class: "form",
    onsubmit: async (e) => {
      e.preventDefault();
      const code = normaliseCode(input.value);
      if (!code) { err.textContent = "Codes are 6 letters and numbers, like K7Q2MX."; return; }
      if (!ctx.isPremium()) return ctx.requirePremium("Leagues");
      submit.disabled = true;
      try {
        const { league } = await callPrivate("/v1/sb/leagues/join", { method: "POST", body: { code } });
        await ctx.loadLeagues(true);
        ctx.toast(`You're in ${league.name}.`);
        openLeague(ctx, league.id);
        ctx.refreshActive();
      } catch (ex) {
        if (ex.status === 402 || ex.status === 401) return ctx.requirePremium("Leagues");
        err.textContent = ex.status === 404 ? "No league has that code. Check it with whoever sent it." : ex.message;
      } finally { submit.disabled = false; }
    },
  }, [el("p", { class: "panel-sub" }, "Enter the code your friend shared."), input, err, submit]);
  ctx.openDetail("Join a league", form);
  setTimeout(() => input.focus(), 50);
}

/* --- one league ---------------------------------------------------------- */

export async function openLeague(ctx, id) {
  const body = el("div", {}, loading());
  ctx.openDetail("League", body);
  let data;
  try {
    data = await callPrivate(`/v1/sb/league?id=${encodeURIComponent(id)}`);
  } catch (ex) {
    if (ex.status === 402 || ex.status === 401) return ctx.requirePremium("Leagues");
    return mount(body, emptyState("Couldn't open this league", ex.message));
  }
  const { league, standings = [] } = data;
  ctx.setDetailTitle(league.name);
  const isPickem = league.kind === "pickem";

  const table = standings.length ? statTable([
    { label: "#", get: (r) => String(r.rank) },
    { label: "Player", get: (r) => r.name ?? "Member" },
    isPickem
      ? { label: "Correct", get: (r) => `${r.correct}/${r.graded}` }
      : { label: "Points", get: (r) => (Math.round((r.points ?? 0) * 10) / 10).toFixed(1) },
  ], standings.map((r, i) => ({ ...r, rank: i + 1 }))) : emptyState("No standings yet");

  mount(body,
    inviteCard(ctx, league),
    el("h3", { class: "sub-head" }, "Standings"),
    table,
    isPickem ? await othersPicks(league) : el("p", { class: "fine" },
      "Points are each member's squad-game total this season. Members link their squad by signing in on the phone they play on."),
    el("button", {
      class: "btn btn-danger", type: "button",
      onclick: async () => {
        if (!confirm(`Leave ${league.name}?`)) return;
        try {
          await callPrivate("/v1/sb/leagues/leave", { method: "POST", body: { id: league.id } });
          await ctx.loadLeagues(true);
          ctx.closeDetail();
          ctx.refreshActive();
        } catch (ex) { ctx.toast(ex.message); }
      },
    }, "Leave league"),
  );
}

async function othersPicks(league) {
  try {
    const d = await callPrivate(`/v1/sb/league/picks?id=${encodeURIComponent(league.id)}`);
    const started = (d.events ?? []).filter((e) => e.status !== "scheduled");
    if (!started.length || !d.others?.length) {
      return el("p", { class: "fine" }, "Everyone's picks appear here as each game kicks off — not before.");
    }
    const label = (e, pick) => pick === "home" ? e.home.abbr : pick === "away" ? e.away.abbr : pick === "draw" ? "Draw" : "–";
    return el("div", {}, [
      el("h3", { class: "sub-head" }, `Week ${d.week} picks`),
      statTable(
        [{ label: "Game", get: (e) => `${e.away.abbr}@${e.home.abbr}` },
          ...d.others.map((o) => ({ label: o.name ?? "Member", get: (e) => label(e, o.picks?.[e.id]) }))],
        started),
    ]);
  } catch {
    return null;
  }
}

function inviteCard(ctx, league) {
  const url = inviteUrl(league.invite_code);
  const qrBox = el("div", { class: "qr-box", "aria-label": `QR code for invite ${league.invite_code}` });
  // The encoder is vendored (MIT) and imported on demand so the first paint
  // never waits for it; it is still in SHELL, so it works offline.
  import("../vendor/qrcode.mjs").then(({ default: qrcode }) => {
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    // createSvgTag builds markup from OUR url only (code alphabet is
    // [A-Z2-9]), never from API text, so parsing it is safe.
    const tpl = document.createElement("template");
    tpl.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    qrBox.replaceChildren(tpl.content);
  }).catch(() => qrBox.replaceChildren(el("p", { class: "fine" }, "QR code unavailable — share the code instead.")));

  return el("div", { class: "panel invite-card" }, [
    el("p", { class: "panel-sub" }, "Invite friends"),
    el("p", { class: "invite-code", "aria-label": `Invite code ${[...league.invite_code].join(" ")}` }, league.invite_code),
    qrBox,
    el("div", { class: "btn-row" }, [
      "share" in navigator ? el("button", {
        class: "btn btn-primary", type: "button",
        onclick: () => navigator.share({ title: league.name, text: `Join my Sportsbook league "${league.name}" — code ${league.invite_code}`, url })
          .catch(() => { /* user closed the sheet */ }),
      }, "Share invite") : null,
      el("button", {
        class: "btn", type: "button",
        onclick: () => navigator.clipboard?.writeText(league.invite_code)
          .then(() => ctx.toast("Code copied."), () => ctx.toast(league.invite_code)),
      }, "Copy code"),
    ]),
    el("p", { class: "fine" }, "On iPhone, a link opens in Safari rather than the installed app. If that happens, open Sportsbook and enter the code."),
  ]);
}
