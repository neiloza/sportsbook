/* ============================================================================
 * store.js — the user's data, on the user's device.
 *
 * Two things this module exists to enforce:
 *
 * 1. ONE namespaced, versioned key: "<app>:v1". When the shape changes
 *    incompatibly you bump the version and add a migration; you never
 *    silently reinterpret old bytes as new ones. Forest carries live
 *    migrations for five prior versions of its store and has never lost a
 *    user's forest.
 *
 * 2. EVERY access is guarded. A disabled store (Safari private mode), a quota
 *    error, or corrupt JSON must never be able to crash the app. Reads fall
 *    back to a default; writes silently no-op. The `typeof window` guards are
 *    there so the same module can be imported during SSR.
 * ========================================================================= */

const APP = "sportsbook";
const VERSION = 1;
export const STORAGE_KEY = `${APP}:v${VERSION}`;

/* The shape of a brand-new user. Keep it a function, not a shared object —
 * a shared default gets mutated by the first thing that touches it. */
function defaultState() {
  return {
    v: VERSION,
    createdAt: Date.now(),
    settings: {
      // `sound` is unused by Sportsbook but kept: the kit's smoke test
      // round-trips it to prove the store works, and a key nobody reads costs
      // nothing. Deleting it breaks four shell checks for no gain.
      sound: true,
      newsComp: "all",          // News tab filter chip
      scorecardMode: "results", // "results" | "pickem"
      fantasyMode: "squad",     // "squad" | "leagues"
    },

    /* Favorites: DECISIONS, not content (house rule 5). Each kind is a map of
     * id -> { on, at }. A removal is a tombstone ({ on: false, at }) rather
     * than a deleted key, because cloud save merges by union: with the key
     * simply gone, the other device's copy would bring the favourite straight
     * back. The merge in app.js keeps whichever side has the newer `at`. */
    favorites: { teams: {}, players: {}, events: {}, comps: {} },

    /* Solo pick'em. eventId -> { pick, at, comp, season, week, start_time,
     * home, away, result }. home/away are the abbreviations at pick time so
     * history can render without refetching. `result` is written once, when
     * the app first sees the game final: "correct" | "wrong" | "void". */
    picks: {},

    /* The squad game's anonymous identity. The token is a credential for the
     * handle only (it can post lineups under that nickname, nothing else);
     * it lives here so Download backup carries it to a new phone. */
    squad: { handle: null },
  };
}

/* ---------------------------------------------------------------------------
 * Migrations. Keyed by the version being migrated FROM. Each returns the next
 * version's shape. They chain, so a v1 save walks all the way to current.
 *
 * Add one every time you bump VERSION. Deleting an old migration strands
 * anyone who has not opened the app since — which, for a local-first app with
 * no backup, means losing their data permanently.
 * ------------------------------------------------------------------------- */
const MIGRATIONS = {
  // 1: (old) => ({ ...old, v: 2, newField: [] }),
};

function migrate(data) {
  let state = data;
  while (state.v < VERSION && MIGRATIONS[state.v]) {
    state = MIGRATIONS[state.v](state);
  }
  // A save from a FUTURE version (user opened a newer deploy on another
  // device, then an older cached one here) is not migratable. Leave it alone
  // rather than corrupting it — worst case this session runs on defaults.
  if (state.v !== VERSION) return null;
  return state;
}

/* --- raw, guarded primitives --------------------------------------------- */

export function readString(key) {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeString(key, value) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key, value); } catch { /* store unavailable */ }
}

export function readFlag(key) {
  return readString(key) === "1";
}

export function writeFlag(key, value = true) {
  if (typeof window === "undefined") return;
  try {
    if (value) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch { /* store unavailable */ }
}

/* --- the app's state ------------------------------------------------------ */

export function loadState() {
  const raw = readString(STORAGE_KEY);
  if (!raw) return defaultState();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultState();  // corrupt JSON — start clean rather than crash
  }

  if (!parsed || typeof parsed !== "object") return defaultState();
  if (typeof parsed.v !== "number") return defaultState();

  const migrated = migrate(parsed);
  if (!migrated) return defaultState();

  // Merge over the defaults so a field added since this save was written
  // exists rather than being undefined at every read site.
  return normalise(migrated);
}

/* Spread the defaults UNDER the stored state (CLAUDE.md invariant), one
 * level deeper for the objects whose keys the app reads directly, so a field
 * added to `settings` or a new favourite kind exists on an old save instead
 * of being undefined at every read site. */
function normalise(saved) {
  const d = defaultState();
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  return {
    ...d,
    ...saved,
    v: VERSION,
    settings: { ...d.settings, ...obj(saved.settings) },
    favorites: { ...d.favorites, ...obj(saved.favorites) },
    picks: obj(saved.picks),
    squad: { ...d.squad, ...obj(saved.squad) },
  };
}

export function saveState(state) {
  writeString(STORAGE_KEY, JSON.stringify(state));
}

/* ---------------------------------------------------------------------------
 * Ask the browser not to evict this data.
 *
 * What this does and does not buy you, because the difference matters:
 *
 *   DOES  — exempt the origin from automatic eviction when the device is
 *           short on space. Chrome generally grants this to an installed PWA
 *           without being asked, but "generally" is not a guarantee and
 *           asking costs three lines.
 *
 *   DOES NOT — survive a user deliberately clearing site data. On iOS an
 *           installed app has its own container, so clearing Safari's history
 *           leaves it alone; on Android an installed PWA shares origin
 *           storage with Chrome, so "clear cookies and site data" takes it.
 *           Nothing here changes that.
 *
 *   DOES NOT — survive deleting the app, switching phones, or losing the
 *           device.
 *
 * So this is a floor, not a safety net. The safety net is exportState() below,
 * and this function existing is not a reason to skip it.
 * ------------------------------------------------------------------------- */
export async function requestPersistence() {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;  // unsupported or blocked — nothing to do about it
  }
}

/* Export/import, so taste/progress data survives a device switch or a cache
 * clear. A local-first app with no export is one "clear browsing data" away
 * from losing everything the user built — worth the twenty lines. */
export function exportState(state) {
  return JSON.stringify({ app: APP, v: VERSION, exportedAt: Date.now(), state }, null, 2);
}

export function importState(json) {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || parsed.app !== APP) return null;
    const migrated = migrate(parsed.state);
    return migrated ? normalise(migrated) : null;
  } catch {
    return null;
  }
}
