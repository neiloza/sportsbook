/*
 * account.js — one sign-in for every app on the domain.
 *
 * WHAT THIS IS
 *
 * A thin client for the accounts service at api.thewizardofoza.com. Sign in on
 * any app at *.thewizardofoza.com and every other app is signed in too.
 *
 * HOW THE SINGLE SIGN-ON ACTUALLY WORKS, because it is worth understanding
 * before changing anything here:
 *
 *   The service sets ONE cookie, scoped to ".thewizardofoza.com" rather than
 *   to a single app's host. Every subdomain therefore sends it. The cookie is
 *   HttpOnly, so nothing in this file can read it — and does not need to: the
 *   browser attaches it automatically to every `fetch` made with
 *   `credentials: "include"`.
 *
 * THAT HttpOnly IS THE WHOLE SECURITY ARGUMENT for running our own API. A
 * token this file could read would be a token an XSS in ANY app on the domain
 * could steal, for EVERY app on the domain. Because no JavaScript ever holds
 * it, a compromised app cannot export the session. Do not "simplify" this by
 * moving the token into localStorage so it is easier to inspect.
 *
 * Two halves have to stay in step or everything 401s while the cookie is
 * plainly visible in devtools:
 *
 *   - every call here sets `credentials: "include"`
 *   - the service answers with `Access-Control-Allow-Credentials: true` and an
 *     echoed (never wildcard, never blindly reflected) origin
 *
 * `SameSite=Lax` is enough despite this being cross-ORIGIN, because SameSite
 * is evaluated per SITE — api.thewizardofoza.com and wander.thewizardofoza.com
 * share a registrable domain.
 *
 * THE HONEST WARNING
 *
 * Nothing here has yet spoken to a deployed service. It was written in a
 * sandbox with no network route out, which is exactly the situation
 * LESSONS.md P5 is about. `setup/accounts/verify.mjs` checks it against a real
 * deployment, and `diagnose()` below does the same from inside a browser on a
 * phone, where there is no console. Until one of those has passed, treat every
 * claim in this file as an assumption.
 */

const REQUEST_TIMEOUT_MS = 20_000;   // LESSONS.md 8.3: generous, not clever
const ENTITLEMENT_KEY = "woz:entitlements:v1";

export function createAccount(config) {
  const { apiUrl, appSlug } = config;
  if (!apiUrl || !appSlug) throw new Error("account.js: apiUrl and appSlug are required.");
  const base = apiUrl.replace(/\/$/, "");

  let user = null;
  let entitlements = readCache();
  let loaded = false;
  const listeners = new Set();

  function emit() {
    for (const fn of listeners) {
      try { fn(api); } catch { /* one bad listener must not break the others */ }
    }
  }

  function readCache() {
    try {
      const raw = localStorage.getItem(ENTITLEMENT_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function writeCache(value) {
    try { localStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(value)); } catch { /* fine */ }
  }

  async function call(path, { method = "GET", body } = {}) {
    const controller = new AbortController();
    // Without a deadline a weak signal does not fail, it HANGS, and a pending
    // promise is invisible: no error, no retry, nothing in any console.
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        signal: controller.signal,
        // Without this the cookie is neither sent nor stored, and every call
        // 401s while the cookie is visibly present in devtools.
        credentials: "include",
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      const data = text ? safeJson(text) : null;
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

  function safeJson(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  function adopt(payload) {
    user = payload?.user ?? null;
    if (payload && payload.entitlements) {
      entitlements = payload.entitlements;
      // A POSITIVE answer is written down. See isPaid() for why a negative one
      // is not.
      writeCache(entitlements);
    }
    loaded = true;
    emit();
    return user;
  }

  const api = {
    /**
     * Restore the session and pick up anything in the URL.
     *
     * Returns { recoveryToken, purchase, error } so the app can open the right
     * sheet. Never throws: a sign-in system that can stop an offline-first app
     * from booting has defeated the point of the app.
     */
    async init() {
      const url = new URL(location.href);
      const recoveryToken = url.searchParams.get("reset_token");
      const purchase = url.searchParams.get("purchase");
      const authError = url.searchParams.get("auth_error");

      if (recoveryToken || purchase || authError) {
        // Take them out of the address bar. A reset token in history, or in a
        // screenshot somebody shares, is a live key to the account.
        for (const k of ["reset_token", "purchase", "auth_error"]) url.searchParams.delete(k);
        history.replaceState({}, "", url.pathname + url.search + url.hash);
      }

      try {
        adopt(await call("/v1/me"));
      } catch {
        // Offline, or the service is down. Keep the cached entitlements and
        // carry on — see isPaid().
        loaded = true;
        emit();
      }

      return { recoveryToken, purchase, error: authError };
    },

    user() { return user; },
    signedIn() { return !!user; },
    ready() { return loaded; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /**
     * Has this person bought THIS app?
     *
     * Reads a cache that is deliberately asymmetric: a "paid" answer persists
     * and a "not paid" answer does not. The two arrive looking identical when
     * the network is down, and persisting the wrong one downgrades a paying
     * customer on a plane — the worst failure this system can produce, because
     * it is invisible to us and looks exactly like taking somebody's money and
     * removing the product.
     *
     * The consequence, accepted deliberately: anyone can edit localStorage and
     * unlock the app. This is a $5 app, not DRM. Gate the UI here; verify on
     * the server only where a request costs real money.
     */
    isPaid(slug = appSlug) { return !!entitlements?.[slug]; },

    /** Hand off to Google. Returns here signed in; no third-party script runs. */
    signInWithGoogle(returnTo = location.href.split("#")[0]) {
      location.assign(`${base}/v1/auth/google/start?return_to=${encodeURIComponent(returnTo)}`);
    },

    async signUp(email, password) {
      return adopt(await call("/v1/auth/signup", { method: "POST", body: { email, password } }));
    },

    async signIn(email, password) {
      return adopt(await call("/v1/auth/signin", { method: "POST", body: { email, password } }));
    },

    /**
     * Ask for a reset link.
     *
     * Resolves the same way whether or not the address has an account, and the
     * caller MUST show identical words either way — "no account with that
     * email" is an account-enumeration oracle. Show something like:
     *
     *   "If that address has an account, a link is on its way. It works once
     *    and expires in an hour."
     */
    async sendPasswordReset(email, returnTo = location.href.split("#")[0]) {
      await call("/v1/auth/forgot-password", {
        method: "POST",
        body: { email, return_to: returnTo },
      });
      return { sent: true };
    },

    /** Finish a reset, using the token init() pulled out of the URL. */
    async resetPassword(token, password) {
      return adopt(await call("/v1/auth/reset-password", {
        method: "POST",
        body: { token, password },
      }));
    },

    async signOut() {
      try { await call("/v1/auth/signout", { method: "POST" }); } catch { /* going anyway */ }
      user = null;
      entitlements = {};
      try { localStorage.removeItem(ENTITLEMENT_KEY); } catch { /* fine */ }
      // Local app data is deliberately NOT touched. Signing out of an account
      // is not a request to delete the trips on the phone.
      emit();
    },

    /** Re-read from the server. This is also the "Restore purchases" button. */
    async refresh() {
      try { adopt(await call("/v1/me")); } catch { /* keep what we have */ }
      return entitlements;
    },

    /** Redirect to Stripe. The server names the price; we never do. */
    async startCheckout(slug = appSlug) {
      const data = await call("/v1/checkout", {
        method: "POST",
        body: { app_slug: slug, return_url: location.href.split("#")[0] },
      });
      if (!data?.url) throw new Error("Could not start checkout.");
      location.assign(data.url);
    },

    /**
     * Walk every hop and report all of them.
     *
     * "Sign-in is broken" covers at least six causes with opposite fixes, and
     * a phone has no console. EVERY LINE PRINTED HERE FEEDS THE VERDICT — a
     * hop that failed is never reasoned past because a different hop passed,
     * which is a bug a previous self-test in this estate actually shipped and
     * which sent somebody off to fix data that was fine (LESSONS.md P8).
     *
     * The report is copyable, because the person holding the phone is rarely
     * the person who can act on it.
     */
    async diagnose() {
      const lines = [];
      let ok = true;

      const step = async (label, fn) => {
        const t0 = Date.now();
        try {
          const note = await fn();
          lines.push(`${label}: ok${note ? ` — ${note}` : ""} (${Date.now() - t0}ms)`);
        } catch (err) {
          ok = false;
          lines.push(`${label}: FAILED — ${err.message} (${Date.now() - t0}ms)`);
        }
      };

      lines.push(`app ${appSlug} · host ${location.hostname}`);
      lines.push(`api ${base}`);
      lines.push(`online: ${navigator.onLine}`);

      await step("service reachable", async () => {
        const res = await fetch(`${base}/healthz`, { credentials: "omit" });
        if (!res.ok) throw new Error(`HTTP ${res.status} — the service or its database is down`);
        return "";
      });

      await step("session readable (CORS + cookie)", async () => {
        const data = await call("/v1/me");
        return data?.user ? `signed in as ${data.user.email || data.user.id}` : "not signed in";
      });

      lines.push(`cached entitlements: ${JSON.stringify(readCache())}`);
      lines.push(`this app paid: ${api.isPaid()}`);
      lines.push(
        ok
          ? "VERDICT: every hop above passed."
          : "VERDICT: at least one hop FAILED — see above. If 'service reachable' " +
            "passed but 'session readable' failed, it is CORS or the cookie domain, " +
            "not the service."
      );
      return lines.join("\n");
    },
  };

  return api;
}
