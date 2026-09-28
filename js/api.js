/* ============================================================================
 * api.js — every request the app makes to the Sportsbook API.
 *
 * Three behaviours this module exists to guarantee:
 *
 * 1. THE APP NEVER WAITS FOREVER. Every request has a 20 s deadline
 *    (LESSONS 8.3): on one bar of signal a fetch can hang rather than fail,
 *    and a spinner that never resolves reads as a broken app.
 *
 * 2. LAST GOOD ANSWER, SHOWN AS OLD. Public reads are network-first; on
 *    failure the last successful response for the same URL comes back from
 *    the `sportsbook-data` cache with `stale: true`, and the screen says
 *    "as of 14:32 · offline". A failed request is never cached, and neither
 *    is an empty answer (LESSONS 8.5) — "the network failed" must not turn
 *    into "there are no games".
 *
 * 3. AUTHENTICATED ANSWERS ARE NEVER CACHED. Anything sent with the session
 *    cookie or a handle token is someone's private data; putting it in a
 *    shared cache is how the next person on a shared phone sees it
 *    (INFRASTRUCTURE, "CSP, CORS and the service worker").
 *
 * The data cache is written from the PAGE, not the service worker, because
 * the API is cross-origin and the worker deliberately ignores cross-origin
 * requests. sw.js's activate handler must spare `sportsbook-data`, or every
 * deploy would wipe the offline copy.
 * ========================================================================= */

import { readString, writeString } from "./store.js";

export const DATA_CACHE = "sportsbook-data";
const TIMEOUT_MS = 20_000;
const API_OVERRIDE_KEY = "sportsbook:api";
const PROD_API = "https://api.thewizardofoza.com";

/* `?api=http://localhost:8080` points this device at a local server and is
 * remembered; `?api=` (empty) clears it. Only http(s) URLs are accepted, so a
 * crafted link cannot aim the app at a javascript: URL. */
export function resolveApiBase(loc = globalThis.location) {
  try {
    const param = new URL(loc.href).searchParams.get("api");
    if (param !== null) {
      if (param === "") writeString(API_OVERRIDE_KEY, "");
      else if (/^https?:\/\/[^\s]+$/i.test(param)) writeString(API_OVERRIDE_KEY, param.replace(/\/$/, ""));
    }
  } catch { /* no location (tests): fall through */ }
  return readString(API_OVERRIDE_KEY) || PROD_API;
}

export const API_BASE = resolveApiBase();

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function withTimeout(ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return { signal: ctl.signal, done: () => clearTimeout(timer) };
}

async function openCache() {
  try { return await caches.open(DATA_CACHE); } catch { return null; }
}

function isEmptyAnswer(body) {
  if (!body || typeof body !== "object") return true;
  for (const k of ["events", "items", "weeks", "players", "teams", "rows"]) {
    if (Array.isArray(body[k])) return body[k].length === 0;
  }
  return false;
}

/**
 * GET a public route. Resolves to { data, stale, error }, never rejects:
 * every caller renders something either way, so a rejection would only move
 * the try/catch into every view.
 */
export async function getPublic(path) {
  const url = API_BASE + path;
  const t = withTimeout(TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: t.signal, credentials: "omit" });
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
    const text = await res.text();
    const data = JSON.parse(text);
    if (!isEmptyAnswer(data)) {
      const cache = await openCache();
      cache?.put(url, new Response(text, { headers: { "content-type": "application/json" } }))
        .catch(() => {});
    }
    return { data, stale: false, error: null };
  } catch (err) {
    const cache = await openCache();
    const hit = await cache?.match(url).catch(() => null);
    if (hit) {
      try { return { data: await hit.json(), stale: true, error: err }; } catch { /* fall through */ }
    }
    return { data: null, stale: false, error: err };
  } finally {
    t.done();
  }
}

/**
 * A request that carries identity: the session cookie, and the squad-game
 * handle token when there is one. Rejects with ApiError carrying the status,
 * because callers treat 401 (sign in), 402 (unlock) and 409 (locked)
 * differently and none of them is a generic failure.
 */
export async function callPrivate(path, { method = "GET", body, handleToken } = {}) {
  const t = withTimeout(TIMEOUT_MS);
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (handleToken) headers["x-sb-handle"] = handleToken;
  try {
    const res = await fetch(API_BASE + path, {
      method,
      credentials: "include",
      cache: "no-store",
      signal: t.signal,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty or not JSON */ }
    if (!res.ok) throw new ApiError(data?.error ?? `HTTP ${res.status}`, res.status);
    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("Could not reach Sportsbook. Check your connection and try again.", 0);
  } finally {
    t.done();
  }
}
