/*
 * sync.js — cloud save, without giving up offline-first.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE:
 *
 *   The DEVICE is the source of truth. The server is a durable, cross-device
 *   MIRROR of it.
 *
 * Not the other way round, and the difference is not academic:
 *
 *   * Most people never sign in. Their data must work exactly as well as a
 *     signed-in user's, forever, with no account.
 *   * The apps are offline-first. A deck that will not deal on a plane
 *     because an API in Virginia is unreachable has thrown away the entire
 *     reason the app was built this way.
 *   * A service outage must cost nobody anything but sync.
 *
 * So: the app reads and writes localStorage as it always did. This module
 * mirrors it, in the background, when signed in, and merges what comes back.
 * Deleting this file must leave a working app.
 *
 * WHAT A DOCUMENT IS
 *
 * One row per logical bundle — "saved", "trips", "settings" — not one per
 * record. Thousands of fine-grained rows would mean thousands of requests and
 * a merge per record; a handful of coarse documents means one push, and a
 * merge the app can reason about. The cost is that two devices editing the
 * same bundle conflict more often, which is exactly what mergeDocument below
 * is for.
 */

/*
 * A cheap content fingerprint, used to answer "has this actually changed?".
 *
 * IT EXISTS TO STOP A PING-PONG LOOP, not to save bytes. Without it:
 *   device A pulls -> merges -> writes -> persist() -> touch() -> pushes
 *   device B pulls that -> merges -> writes -> pushes
 *   device A pulls that -> ...
 * Two devices left open would sync each other forever, burning battery and
 * inflating the sequence, while nothing whatsoever had changed. Comparing the
 * serialised value breaks the cycle at both ends: an unchanged merge does not
 * write, and an unchanged document does not push.
 *
 * JSON.stringify is key-order sensitive, so this can report a false CHANGE —
 * which costs one redundant push and is harmless. It can never report a false
 * "unchanged", which is the direction that would lose data.
 */
function fingerprint(value) {
  try { return JSON.stringify(value ?? null); } catch { return null; }
}

const CURSOR_KEY = (app) => `woz:sync:${app}:cursor`;
const REV_KEY = (app) => `woz:sync:${app}:revs`;
const WRITER_KEY = "woz:sync:writer";
const PUSH_DEBOUNCE_MS = 2500;
const REQUEST_TIMEOUT_MS = 20_000;

/* ---------------------------------------------------------------------------
 * THE DEFAULT MERGE, and the most important twenty lines in this file.
 *
 * Last-write-wins is the obvious choice and it is WRONG for most of what these
 * apps hold. Two phones both offline, both saving places; LWW throws away
 * everything the loser did, silently, with no error and nothing to recover
 * from. That is the classic way a sync system quietly destroys somebody's
 * work, and it is unrecoverable because the losing copy is simply gone.
 *
 * So the default is UNION for id-keyed objects, which is what the house data
 * shape already is: `saved` and `skipped` are maps of id → timestamp, a trip
 * is keyed by its id (APP_DESIGN_RULES rule 5, "store decisions, never
 * content"). Union two of those and nobody loses anything — the worst case is
 * that a place one device removed comes back, which is visible, understandable
 * and fixable by the user. Compare that to a month of sessions vanishing.
 *
 * Scalars and arrays cannot be unioned meaningfully, so they take the newer
 * value. Say so, per key, if that is wrong for your app.
 * ------------------------------------------------------------------------- */
export function mergeDocument(local, remote, { preferLocal = false } = {}) {
  if (remote === null || remote === undefined) return local;
  if (local === null || local === undefined) return remote;

  const bothPlainObjects =
    typeof local === "object" && typeof remote === "object" &&
    !Array.isArray(local) && !Array.isArray(remote);

  if (!bothPlainObjects) {
    // An array is ordered and positional; unioning one produces nonsense.
    // Whoever the caller says is newer wins, and the caller decides.
    return preferLocal ? local : remote;
  }

  const out = { ...remote, ...{} };
  for (const [key, localValue] of Object.entries(local)) {
    if (!(key in out)) {
      out[key] = localValue;
      continue;
    }
    const remoteValue = out[key];
    const bothObjects =
      localValue && remoteValue &&
      typeof localValue === "object" && typeof remoteValue === "object" &&
      !Array.isArray(localValue) && !Array.isArray(remoteValue);

    // Recurse so a nested id-keyed map (trips inside a bundle, say) unions
    // too, rather than one whole branch replacing the other.
    out[key] = bothObjects
      ? mergeDocument(localValue, remoteValue, { preferLocal })
      : (preferLocal ? localValue : remoteValue);
  }
  return out;
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota, private mode */ }
}

function writerId() {
  let id = null;
  try { id = localStorage.getItem(WRITER_KEY); } catch { /* fine */ }
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem(WRITER_KEY, id); } catch { /* fine */ }
  }
  return id;
}

/**
 * @param account  the object from account.js
 * @param options.appSlug   must match the app's slug everywhere else
 * @param options.documents {
 *     [key]: {
 *       read()          -> the current local value
 *       write(value)    -> persist a merged value locally
 *       merge?(l, r)    -> override the default union
 *       preferLocal?    -> for non-objects, which side wins
 *     }
 *   }
 */
export function createSync(account, { apiUrl, appSlug, documents, onChange } = {}) {
  const base = apiUrl.replace(/\/$/, "");
  const keys = Object.keys(documents ?? {});
  let revs = readJson(REV_KEY(appSlug), {});
  // What we last sent for each key, so an unchanged document is not re-sent.
  // Session-only on purpose: after a relaunch, one redundant push per document
  // is a fine price for not persisting a claim about the server that might be
  // wrong.
  const lastSent = new Map();
  let pushTimer = null;
  let running = false;
  let pendingWhileRunning = false;
  let lastError = null;

  async function call(path, { method = "GET", body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        signal: controller.signal,
        credentials: "include",
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const err = new Error(data?.error || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function saveRevs() { writeJson(REV_KEY(appSlug), revs); }

  /*
   * CLOUD SAVE IS PART OF THE PAID UNLOCK.
   *
   * Decided 2026-09-22. It is the one feature in the estate with a real,
   * ongoing server cost, so charging for it is honest in a way that charging
   * for a local feature would not be (APP_DESIGN_RULES rule 7).
   *
   * What this must NEVER mean, and the reason the gate is here rather than
   * somewhere cleverer: a free user loses nothing. Their data lives on the
   * device exactly as it always did, Download backup still works and is still
   * never paywalled. The paid feature is the MIRROR, not the data.
   *
   * isPaid() reads a cache that is deliberately asymmetric — a "paid" answer
   * persists, a "not paid" answer does not — so a paying customer on a plane
   * keeps syncing when the signal returns rather than being silently
   * downgraded mid-flight.
   */
  function canSync() {
    return account.signedIn() && account.isPaid(appSlug);
  }

  /** Pull, merge into local, then push whatever local still has that differs. */
  async function sync({ full = false } = {}) {
    if (!account.signedIn()) return { skipped: "signed out" };
    if (!account.isPaid(appSlug)) return { skipped: "not unlocked" };
    if (running) { pendingWhileRunning = true; return { skipped: "already running" }; }
    running = true;
    lastError = null;
    let changed = false;

    try {
      // ---- pull -------------------------------------------------------
      let cursor = full ? 0 : Number(readJson(CURSOR_KEY(appSlug), 0)) || 0;
      if (full) revs = {};

      for (let page = 0; page < 20; page++) {
        const got = await call(`/v1/data?app=${encodeURIComponent(appSlug)}&since=${cursor}`);
        for (const doc of got.documents ?? []) {
          const spec = documents[doc.key];
          // A document this build does not know about is LEFT ALONE, not
          // dropped: an older client must never delete data a newer one
          // wrote, or rolling out a new version costs everyone their new
          // features' data.
          if (!spec) { revs[doc.key] = doc.rev; continue; }

          if (doc.deleted) {
            revs[doc.key] = doc.rev;
            continue;
          }
          const local = spec.read();
          const merge = spec.merge ?? mergeDocument;
          const merged = merge(local, doc.value, { preferLocal: spec.preferLocal });
          revs[doc.key] = doc.rev;

          // Only write if the merge actually produced something different.
          // Writing an identical value would call persist(), which calls
          // touch(), which schedules a push — see fingerprint() above.
          if (fingerprint(merged) !== fingerprint(local)) {
            spec.write(merged);
            changed = true;
          }
        }
        cursor = got.cursor ?? cursor;
        if (!got.more) break;
      }
      writeJson(CURSOR_KEY(appSlug), cursor);
      saveRevs();

      // ---- push -------------------------------------------------------
      const outgoing = [];
      for (const key of keys) {
        const value = documents[key].read();
        const print = fingerprint(value);
        // Unchanged since the last accepted push? Nothing to say.
        if (lastSent.get(key) === print) continue;
        outgoing.push({ key, value, base_rev: revs[key] ?? 0, _print: print });
      }

      if (!outgoing.length) {
        if (changed) onChange?.();
        return { ok: true, changed, conflicted: false };
      }

      const pushed = await call(`/v1/data?app=${encodeURIComponent(appSlug)}`, {
        method: "POST",
        body: {
          documents: outgoing.map(({ _print, ...doc }) => doc),
          writer: writerId(),
        },
      });
      const prints = new Map(outgoing.map((d) => [d.key, d._print]));

      /*
       * A conflict is NORMAL, not an error: it means the other device won the
       * race. Merge its copy in and push again on the next tick with the
       * revision it told us about. Retrying immediately in a loop would spin
       * against a device that is also syncing, so this waits for the debounce.
       */
      let conflicted = false;
      for (const result of pushed.results ?? []) {
        if (result.ok) {
          revs[result.key] = result.rev;
          lastSent.set(result.key, prints.get(result.key));
          continue;
        }
        if (result.conflict) {
          conflicted = true;
          const spec = documents[result.key];
          if (!spec) { revs[result.key] = result.server.rev; continue; }
          if (!result.server.deleted && result.server.value !== null) {
            const merge = spec.merge ?? mergeDocument;
            spec.write(merge(spec.read(), result.server.value, { preferLocal: spec.preferLocal }));
            changed = true;
          }
          revs[result.key] = result.server.rev;
          // The merge changed local, so whatever we last sent is stale.
          lastSent.delete(result.key);
        }
      }
      saveRevs();
      if (conflicted) schedulePush();

      if (changed) onChange?.();
      return { ok: true, changed, conflicted };
    } catch (err) {
      /*
       * A failed sync is never an error the user sees and never touches local
       * data. "Could not reach the server" and "there is nothing there" are
       * different facts that arrive looking identical, and acting on the
       * wrong one is how a device wipes itself clean.
       */
      lastError = err;
      if (err.status === 401) return { skipped: "signed out" };
      return { error: err.message };
    } finally {
      running = false;
      if (pendingWhileRunning) {
        pendingWhileRunning = false;
        schedulePush();
      }
    }
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    // Debounced: a deck being swiped writes on every card, and one request per
    // swipe is a request storm for no benefit.
    pushTimer = setTimeout(() => { sync().catch(() => {}); }, PUSH_DEBOUNCE_MS);
  }

  const api = {
    /**
     * Forget everything this device knows about the server's state.
     *
     * MUST be called on sign-out, and it is not tidiness — it is a bug fix.
     * `seq` comes from one global sequence shared by all users, so a second
     * person signing in on the same device would pull `since=<the first
     * person's cursor>` and, because their own rows have LOWER sequence
     * numbers, receive NOTHING. Their data would appear to be gone, on a
     * shared phone, with no error anywhere.
     *
     * The stored revisions are the same story in a different field: they
     * describe another account's documents, so every push would conflict
     * against rows that are not theirs.
     *
     * Local app data is deliberately untouched. Signing out is not a request
     * to delete the trips on the phone.
     */
    reset() {
      revs = {};
      lastSent.clear();
      clearTimeout(pushTimer);
      try {
        localStorage.removeItem(CURSOR_KEY(appSlug));
        localStorage.removeItem(REV_KEY(appSlug));
      } catch { /* private mode */ }
    },

    /** Call after every local write. Cheap, debounced, safe when signed out. */
    touch() {
      if (canSync()) schedulePush();
    },

    sync,

    /** Is cloud save actually running for this person? The UI asks. */
    enabled: canSync,

    /** Pull everything and re-merge. The "my other phone is missing things" button. */
    full() { return sync({ full: true }); },

    async usage() {
      try { return await call("/v1/data/usage"); } catch { return null; }
    },

    /**
     * Called once, after account.init(). Wires the triggers that matter:
     * launch, returning to the foreground, and the network coming back.
     */
    start() {
      if (canSync()) sync().catch(() => {});

      let wasSignedIn = account.signedIn();
      let couldSync = canSync();
      account.onChange(() => {
        const now = account.signedIn();
        const canNow = canSync();

        // Buying the unlock while signed in is its own moment: this device
        // has local data that has never been mirrored, and it must go up.
        if (canNow && !couldSync && now === wasSignedIn) {
          sync({ full: true }).catch(() => {});
        }
        couldSync = canNow;

        if (now && !wasSignedIn) {
          // Signing IN is the interesting moment: this device has local data
          // and the account may have more. Start from a clean slate so no
          // cursor or revision from a previous account survives, then FULL
          // sync so both sides merge rather than either winning.
          api.reset();
          sync({ full: true }).catch(() => {});
        } else if (!now && wasSignedIn) {
          api.reset();
        }
        wasSignedIn = now;
      });

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") sync().catch(() => {});
      });
      window.addEventListener("online", () => { sync().catch(() => {}); });
      // sync() checks canSync() itself, so these listeners stay simple and a
      // free user's triggers are no-ops rather than refused requests.

      // A last push on the way out. `visibilitychange` is the reliable one on
      // iOS — `beforeunload` frequently never fires on a phone.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden" && canSync()) {
          sync().catch(() => {});
        }
      });
    },

    /** For the in-app self-test. Every line feeds the verdict. */
    async diagnose() {
      const lines = [];
      lines.push(`sync app: ${appSlug}`);
      lines.push(`signed in: ${account.signedIn()}`);
      lines.push(`unlocked (cloud save enabled): ${account.isPaid(appSlug)}`);
      lines.push(`cursor: ${readJson(CURSOR_KEY(appSlug), 0)}`);
      lines.push(`known revisions: ${JSON.stringify(revs)}`);
      lines.push(`documents: ${keys.join(", ") || "none"}`);
      if (lastError) lines.push(`last error: ${lastError.message}`);
      if (account.signedIn()) {
        const u = await api.usage();
        lines.push(u
          ? `server holds ${Math.round(u.bytes / 1024)}KB of ${Math.round(u.limit / 1024 / 1024)}MB`
          : "usage: FAILED to read");
      }
      return lines.join("\n");
    },
  };

  return api;
}
