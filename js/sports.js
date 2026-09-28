/* ============================================================================
 * sports.js — the sport registry, as the app sees it.
 *
 * The SERVER is the source of truth for which competitions exist and which
 * are switched on (GET /v1/sb/sports, from registry.js in woz-accounts). This
 * file holds only what the app needs to draw a competition before that answer
 * arrives — or when it never does, offline on first launch — plus the labels
 * and glyphs, which are presentation and belong here.
 *
 * NFL is the starting sport (decided 2026-09-28). The soccer competitions are
 * wired but off: turning one on is a server change (registry + adapter), and
 * the app picks it up from /v1/sb/sports with no release.
 * ========================================================================= */

export const COMPETITIONS = [
  { id: "nfl",            sport: "football", name: "NFL",              short: "NFL", emoji: "🏈", draws: false, enabled: true },
  { id: "eng.1",          sport: "soccer",   name: "Premier League",   short: "EPL", emoji: "⚽", draws: true,  enabled: false },
  { id: "usa.1",          sport: "soccer",   name: "MLS",              short: "MLS", emoji: "⚽", draws: true,  enabled: false },
  { id: "uefa.champions", sport: "soccer",   name: "Champions League", short: "UCL", emoji: "⚽", draws: true,  enabled: false },
];

export const DEFAULT_COMP = "nfl";

/* Merge the server's answer over the local list: the server decides
 * `enabled`, `season` and `week`; local keeps the emoji. A competition the
 * server knows and this build does not still shows, with a generic glyph —
 * a new sport should not need an app release to appear. */
export function mergeCompetitions(serverList) {
  if (!Array.isArray(serverList) || !serverList.length) return COMPETITIONS.map((c) => ({ ...c }));
  const local = new Map(COMPETITIONS.map((c) => [c.id, c]));
  return serverList.map((s) => ({ emoji: "🏟️", ...local.get(s.id), ...s }));
}

export function compLabel(comps, id) {
  return comps.find((c) => c.id === id)?.short ?? id.toUpperCase();
}
