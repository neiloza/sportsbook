/*
 * Unit tests for the app's pure rules (js/logic.js) and one structural rule
 * about the service worker. Node's built-in runner, no browser, milliseconds.
 *
 *   node --test test/unit.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gradePick, pickLocked, pickStats, weeklySeries,
  toggleFavorite, isFavorite, favoriteIds, mergeFavorites, mergePicks,
  badgeInk, kickoffLabel, normaliseCode,
  SLOT_ORDER, lineupToApi, lineupFromApi, lineupCost, whyNot, slotAccepts,
} from "../js/logic.js";
import { mergeCompetitions } from "../js/sports.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ev = (h, a, status = "final") => ({ status, home: { score: h }, away: { score: a } });

/* --- pick'em ------------------------------------------------------------- */

test("a pick is graded only once the game is final", () => {
  assert.equal(gradePick("home", ev(21, 17, "live")), null);
  assert.equal(gradePick("home", ev(null, null, "scheduled")), null);
  assert.equal(gradePick("home", ev(21, 17)), "correct");
  assert.equal(gradePick("away", ev(21, 17)), "wrong");
});

test("a cancelled game voids the pick; a postponed one does not", () => {
  assert.equal(gradePick("home", { status: "cancelled" }), "void");
  assert.equal(gradePick("home", { status: "postponed" }), null);
});

test("an NFL tie voids a winner pick instead of counting it wrong", () => {
  assert.equal(gradePick("home", ev(20, 20)), "void");
  assert.equal(gradePick("draw", ev(1, 1)), "correct");
});

test("picks lock at kickoff, and once a game is live whatever the clock says", () => {
  const start = Date.parse("2026-10-04T17:00:00Z");
  const e = { status: "scheduled", start_time: "2026-10-04T17:00:00Z" };
  assert.equal(pickLocked(e, start - 1), false);
  assert.equal(pickLocked(e, start), true);
  assert.equal(pickLocked({ ...e, status: "live" }, start - 3600e3), true);
});

test("record, accuracy and streaks, in kickoff order, skipping voids", () => {
  const p = (t, result) => ({ start_time: `2026-09-${t}T17:00:00Z`, result });
  const picks = {
    a: p("07", "correct"), b: p("08", "correct"), c: p("09", "correct"),
    d: p("10", "wrong"), e: p("11", "void"), f: p("12", "correct"), g: p("13", "correct"),
  };
  const s = pickStats(picks);
  assert.equal(s.correct, 5);
  assert.equal(s.wrong, 1);
  assert.equal(s.total, 6);
  assert.equal(s.pct, 83);
  assert.equal(s.best, 3);
  assert.equal(s.streak, 2);
  assert.equal(pickStats({ x: p("01", "wrong"), y: p("02", "wrong") }).streak, -2);
  assert.equal(pickStats({}).pct, null);
});

test("weekly series groups by season and week, oldest first", () => {
  const s = weeklySeries({
    a: { season: 2026, week: 2, result: "correct" },
    b: { season: 2026, week: 10, result: "wrong" },
    c: { season: 2026, week: 2, result: "wrong" },
    d: { season: 2026, week: 3 },            // ungraded: ignored
  });
  assert.deepEqual(s.map((w) => [w.week, w.correct, w.total]), [[2, 1, 2], [10, 0, 1]]);
});

/* --- favorites & cloud-save merges ------------------------------------------ */

test("toggling leaves a tombstone, not a missing key", () => {
  let f = { teams: {} };
  f = toggleFavorite(f, "teams", "12", 1);
  assert.equal(isFavorite(f, "teams", "12"), true);
  f = toggleFavorite(f, "teams", "12", 2);
  assert.equal(isFavorite(f, "teams", "12"), false);
  assert.deepEqual(f.teams["12"], { on: false, at: 2 });
  assert.deepEqual(favoriteIds(f, "teams"), []);
});

test("merge: an un-star on this phone beats an older star from the other", () => {
  const local = { teams: { a: { on: false, at: 20 } } };
  const remote = { teams: { a: { on: true, at: 10 }, b: { on: true, at: 5 } } };
  const m = mergeFavorites(local, remote);
  assert.equal(m.teams.a.on, false);
  assert.equal(m.teams.b.on, true);
  // …and whichever side is "local" does not change the answer.
  assert.deepEqual(mergeFavorites(remote, local), m);
});

test("merge: picks keep the later choice and never lose a graded result", () => {
  const local = { e1: { pick: "home", at: 5, result: "correct" }, e2: { pick: "away", at: 9 } };
  const remote = { e1: { pick: "home", at: 7 }, e2: { pick: "home", at: 3 }, e3: { pick: "home", at: 1 } };
  const m = mergePicks(local, remote);
  assert.equal(m.e1.result, "correct");
  assert.equal(m.e2.pick, "away");
  assert.ok(m.e3);
});

/* --- presentation -------------------------------------------------------- */

test("badge ink is readable on pale and dark team colours", () => {
  assert.equal(badgeInk("ffb612"), "#2b1d13");   // gold → dark ink
  assert.equal(badgeInk("002244"), "#ffffff");   // navy → white
  assert.equal(badgeInk(null), "#ffffff");       // no colour → default badge
});

test("kickoff label: time only today, weekday within the week", () => {
  const now = Date.parse("2026-10-01T16:00:00Z");
  assert.equal(kickoffLabel("2026-10-01T23:15:00Z", now, "America/New_York"), "7:15 PM");
  assert.equal(kickoffLabel("2026-10-04T17:00:00Z", now, "America/New_York"), "Sun 1:00 PM");
});

test("invite codes normalise case and spacing and refuse look-alikes", () => {
  assert.equal(normaliseCode(" k7q-2mx "), "K7Q2MX");
  assert.equal(normaliseCode("K7Q2M0"), null);   // 0 is not in the alphabet
  assert.equal(normaliseCode("K7Q2M"), null);
});

test("the server's competition list wins, the local glyph survives", () => {
  const merged = mergeCompetitions([{ id: "nfl", enabled: true, week: 5 }, { id: "new.league", enabled: true }]);
  assert.equal(merged[0].emoji, "🏈");
  assert.equal(merged[0].week, 5);
  assert.equal(merged[1].emoji, "🏟️");
});

/* --- squad builder mirror ------------------------------------------------- */

test("lineup round-trips between slot array and API shape", () => {
  const slots = ["q", "r1", "r2", "w1", "w2", "w3", "t", "f"];
  assert.deepEqual(lineupToApi(slots), { QB: ["q"], RB: ["r1", "r2"], WR: ["w1", "w2", "w3"], TE: ["t"], FLEX: ["f"] });
  assert.deepEqual(lineupFromApi(lineupToApi(slots)), slots);
  assert.equal(SLOT_ORDER.length, 8);
});

test("FLEX takes RB, WR or TE and nothing else", () => {
  assert.ok(slotAccepts("FLEX", "TE"));
  assert.ok(!slotAccepts("FLEX", "QB"));
  assert.ok(!slotAccepts("RB", "WR"));
});

test("the builder refuses budget, team-cap, duplicate and position breaks", () => {
  const players = {
    a: { id: "a", position: "RB", team_id: "T1", team_abbr: "AAA", price: 40 },
    b: { id: "b", position: "RB", team_id: "T1", team_abbr: "AAA", price: 10 },
    c: { id: "c", position: "WR", team_id: "T1", team_abbr: "AAA", price: 10 },
    d: { id: "d", position: "WR", team_id: "T1", team_abbr: "AAA", price: 10 },
    e: { id: "e", position: "WR", team_id: "T2", team_abbr: "BBB", price: 70 },
  };
  const byId = (id) => players[id];
  const slots = [null, "a", "b", "c", null, null, null, null];
  const base = { slots, budget: 100, maxPerTeam: 3, playerById: byId };
  assert.match(whyNot({ ...base, slotIndex: 4, player: players.d }), /Max 3 from AAA/);
  assert.match(whyNot({ ...base, slotIndex: 4, player: players.e }), /Over budget by 30\.0/);
  assert.match(whyNot({ ...base, slotIndex: 0, player: players.e }), /QB takes QB/);
  assert.match(whyNot({ ...base, slotIndex: 2, player: players.a }), /Already in your lineup/);
  // Replacing a player in the same slot frees their price and team place.
  assert.equal(whyNot({ ...base, slotIndex: 3, player: players.d }), null);
  assert.equal(lineupCost(slots, (id) => byId(id)?.price), 60);
});

/* --- the worker ------------------------------------------------------------ */

/*
 * LESSONS 1.4: on a first visit the page imports its modules BEFORE the
 * worker controls it, so the fetch handler never sees them, and a module
 * missing from SHELL is missing offline — the app works until someone opens
 * it on a plane. So walk the real import graph from js/app.js and require
 * every file in it to be in SHELL.
 */
test("every module the app imports is in the service worker's SHELL", () => {
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const shell = new Set([...sw.matchAll(/"\.\/([^"]+)"/g)].map((m) => m[1]));
  const seen = new Set();
  const walk = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const m of src.matchAll(/(?:import|export)\s[^"'`]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const spec = m[1] ?? m[2];
      if (!spec.startsWith(".")) continue;
      walk(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)));
    }
  };
  walk("js/app.js");
  const missing = [...seen].filter((f) => !shell.has(f));
  assert.deepEqual(missing, [], `missing from SHELL: ${missing.join(", ")}`);
  assert.ok(seen.size >= 15, `walked only ${seen.size} modules — is the import regex still matching?`);
});

test("the worker spares the data cache on activate", () => {
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  assert.match(sw, /k !== CACHE && k !== DATA_CACHE/);
  assert.match(sw, /DATA_CACHE = "sportsbook-data"/);
});
