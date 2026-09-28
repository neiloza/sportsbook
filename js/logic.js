/* ============================================================================
 * logic.js — the app's rules as pure functions (house rule 9).
 *
 * No DOM, no fetch, no storage, no clock unless it is passed in. Everything
 * here is covered by test/unit.test.mjs, which runs in milliseconds; the
 * views only call these and draw the result.
 * ========================================================================= */

/* --- pick'em --------------------------------------------------------------- */

/**
 * Grade one pick against an event. Returns "correct" | "wrong" | "void", or
 * null while the game is not over.
 *
 * "void" covers a cancelled game, and a tie in a sport without draws (an NFL
 * tie after overtime is rare but real, and nobody picked it — it must not
 * count against anyone). A postponed game is NOT void: it will be played,
 * and the pick stands until it is.
 */
export function gradePick(pick, event) {
  if (!event) return null;
  if (event.status === "cancelled") return "void";
  if (event.status !== "final") return null;
  const h = event.home?.score, a = event.away?.score;
  if (typeof h !== "number" || typeof a !== "number") return null;
  const outcome = h > a ? "home" : a > h ? "away" : "draw";
  if (outcome === "draw" && pick !== "draw") return "void";
  return pick === outcome ? "correct" : "wrong";
}

/** A pick can be changed until kickoff, judged by the device clock here; the
 *  server enforces the same line with its own clock for league picks. */
export function pickLocked(event, now = Date.now()) {
  if (!event?.start_time) return true;
  if (event.status && event.status !== "scheduled" && event.status !== "postponed") return true;
  return Date.parse(event.start_time) <= now;
}

/**
 * Record, accuracy and streaks over graded picks, in kickoff order.
 * Void picks are skipped entirely: they neither extend nor break a streak.
 */
export function pickStats(picks) {
  const graded = Object.entries(picks ?? {})
    .map(([id, p]) => ({ id, ...p }))
    .filter((p) => p.result === "correct" || p.result === "wrong")
    .sort((x, y) => String(x.start_time).localeCompare(String(y.start_time)));

  let correct = 0, streak = 0, best = 0, run = 0;
  for (const p of graded) {
    if (p.result === "correct") { correct++; run++; best = Math.max(best, run); }
    else run = 0;
  }
  // Current streak: count back from the most recent graded pick. Positive for
  // a winning run, negative for a losing one.
  for (let i = graded.length - 1; i >= 0; i--) {
    const r = graded[i].result;
    if (i === graded.length - 1) { streak = r === "correct" ? 1 : -1; continue; }
    if ((streak > 0) === (r === "correct")) streak += streak > 0 ? 1 : -1;
    else break;
  }
  const total = graded.length;
  return {
    correct,
    wrong: total - correct,
    total,
    pct: total ? Math.round((correct / total) * 100) : null,
    streak,
    best,
  };
}

/** Correct/total per (season, week), oldest first — the chart's series. */
export function weeklySeries(picks) {
  const buckets = new Map();
  for (const p of Object.values(picks ?? {})) {
    if (p.result !== "correct" && p.result !== "wrong") continue;
    const key = `${p.season ?? 0}-${String(p.week ?? 0).padStart(2, "0")}`;
    const b = buckets.get(key) ?? { season: p.season, week: p.week, correct: 0, total: 0 };
    b.total++;
    if (p.result === "correct") b.correct++;
    buckets.set(key, b);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
}

/* --- favorites --------------------------------------------------------------- */

export function isFavorite(favorites, kind, id) {
  return !!favorites?.[kind]?.[id]?.on;
}

/** Returns a NEW favorites object; the caller persists it. */
export function toggleFavorite(favorites, kind, id, now = Date.now()) {
  const on = !isFavorite(favorites, kind, id);
  return {
    ...favorites,
    [kind]: { ...(favorites?.[kind] ?? {}), [id]: { on, at: now } },
  };
}

export function favoriteIds(favorites, kind) {
  return Object.entries(favorites?.[kind] ?? {})
    .filter(([, v]) => v?.on)
    .sort(([, a], [, b]) => (a.at ?? 0) - (b.at ?? 0))
    .map(([id]) => id);
}

/**
 * Cloud-save merge for favorites: per id, the newer decision wins,
 * tombstones included. The kit's default merge would union the maps and then
 * let the remote scalar win, which resurrects an un-starred team whenever the
 * other device is the one that last synced.
 */
export function mergeFavorites(local, remote) {
  const out = {};
  for (const kind of new Set([...Object.keys(local ?? {}), ...Object.keys(remote ?? {})])) {
    const l = local?.[kind] ?? {}, r = remote?.[kind] ?? {};
    const merged = {};
    for (const id of new Set([...Object.keys(l), ...Object.keys(r)])) {
      const a = l[id], b = r[id];
      merged[id] = !a ? b : !b ? a : ((b.at ?? 0) > (a.at ?? 0) ? b : a);
    }
    out[kind] = merged;
  }
  return out;
}

/** Same rule for picks: per event, the later decision wins; a graded result
 *  on either side is kept, because grading is a fact rather than a choice. */
export function mergePicks(local, remote) {
  const out = { ...(remote ?? {}) };
  for (const [id, a] of Object.entries(local ?? {})) {
    const b = out[id];
    if (!b) { out[id] = a; continue; }
    const winner = (b.at ?? 0) > (a.at ?? 0) ? b : a;
    out[id] = { ...winner, result: winner.result ?? a.result ?? b.result ?? undefined };
    if (out[id].result === undefined) delete out[id].result;
  }
  return out;
}

/* --- presentation helpers (pure) ------------------------------------------- */

/** Pick black-brown or white text for a team-colour badge by WCAG contrast,
 *  so a pale team colour (a yellow, a silver) still gets readable letters. */
export function badgeInk(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return "#ffffff";
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const n = parseInt(m[1], 16);
  const L = 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255);
  const onWhite = 1.05 / (L + 0.05);
  const onDark = (L + 0.05) / 0.05;   // near-black ink
  return onWhite >= onDark ? "#ffffff" : "#2b1d13";
}

/** "3:05 PM" style kickoff, or a day+time when it is not today. `tz` is for
 *  tests; the app uses the device's zone. */
export function kickoffLabel(iso, now = Date.now(), tz) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const opts = tz ? { timeZone: tz } : {};
  const day = (ms) => new Intl.DateTimeFormat("en-CA", { ...opts, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
  const time = new Intl.DateTimeFormat("en-US", { ...opts, hour: "numeric", minute: "2-digit" }).format(t);
  if (day(t) === day(now)) return time;
  const wd = new Intl.DateTimeFormat("en-US", { ...opts, weekday: "short" }).format(t);
  if (Math.abs(t - now) < 6 * 864e5) return `${wd} ${time}`;
  const md = new Intl.DateTimeFormat("en-US", { ...opts, month: "short", day: "numeric" }).format(t);
  return `${wd} ${md}, ${time}`;
}

/** "as of 14:32", with "· offline" when the answer came from the cache. */
export function asOfLabel(iso, stale, tz) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return stale ? "offline" : "";
  const time = new Intl.DateTimeFormat("en-US", { ...(tz ? { timeZone: tz } : {}), hour: "numeric", minute: "2-digit" }).format(t);
  return `as of ${time}${stale ? " · offline" : ""}`;
}

export function fmtPts(n) {
  return typeof n === "number" && Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1) : "–";
}

/* --- squad game --------------------------------------------------------------
 * The SERVER validates every lineup (squad.js in woz-accounts) and its
 * answer is final. This mirror exists only so the builder can grey out a
 * player who would break the budget or the team cap BEFORE the user taps
 * Save; if the two ever disagree the server wins and says which rule, so a
 * drift here costs a confusing message, never a wrong lineup.
 * ------------------------------------------------------------------------- */

export const SLOT_ORDER = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX"];
export const FLEX_POSITIONS = ["RB", "WR", "TE"];

export function slotAccepts(slot, position) {
  return slot === "FLEX" ? FLEX_POSITIONS.includes(position) : slot === position;
}

/** lineup as the flat slot array [id|null × 8] ↔ the API's { QB:[..], … } */
export function lineupToApi(slots) {
  const out = { QB: [], RB: [], WR: [], TE: [], FLEX: [] };
  SLOT_ORDER.forEach((slot, i) => { if (slots[i]) out[slot].push(slots[i]); });
  return out;
}

export function lineupFromApi(lineup) {
  const queues = Object.fromEntries(Object.entries(lineup ?? {}).map(([k, v]) => [k, [...(v ?? [])]]));
  return SLOT_ORDER.map((slot) => queues[slot]?.shift() ?? null);
}

export function lineupCost(slots, priceOf) {
  return Math.round(slots.reduce((sum, id) => sum + (id ? priceOf(id) ?? 0 : 0), 0) * 10) / 10;
}

/** Why a player cannot go into a slot right now, or null if they can. */
export function whyNot({ slots, slotIndex, player, budget, maxPerTeam, playerById }) {
  const slot = SLOT_ORDER[slotIndex];
  if (!slotAccepts(slot, player.position)) return `${slot} takes ${slot === "FLEX" ? "RB, WR or TE" : slot}`;
  if (slots.some((id, i) => id === player.id && i !== slotIndex)) return "Already in your lineup";
  const others = slots.filter((id, i) => id && i !== slotIndex).map((id) => playerById(id)).filter(Boolean);
  const cost = others.reduce((s, p) => s + p.price, 0) + player.price;
  if (cost > budget + 1e-9) return `Over budget by ${(cost - budget).toFixed(1)}`;
  if (others.filter((p) => p.team_id === player.team_id).length >= maxPerTeam) {
    return `Max ${maxPerTeam} from ${player.team_abbr}`;
  }
  return null;
}

/* --- invite codes ------------------------------------------------------------ */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Normalise what a person typed or scanned: case, spaces, dashes, and the
 *  look-alikes the alphabet leaves out (O→0 is not in the alphabet, so an O
 *  typed for a zero is simply rejected rather than guessed). */
export function normaliseCode(raw) {
  const s = String(raw ?? "").toUpperCase().replace(/[\s-]/g, "");
  return s.length === 6 && [...s].every((c) => CODE_ALPHABET.includes(c)) ? s : null;
}
