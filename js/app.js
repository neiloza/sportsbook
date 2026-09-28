/* ============================================================================
 * app.js — Sportsbook starts here.
 *
 * Owns the one `ctx` object every view receives: the state and persist(),
 * the competition list, the account and Premium check, the detail sheet,
 * and the cross-tab openers (openEvent / openPlayer / openTeam). Views never
 * import each other; they talk through ctx, so a tab can be rewritten
 * without touching the other four.
 *
 * The kit's plumbing (shell, install, store, worker, accounts, cloud save)
 * is unchanged in spirit; see setup/ in the GameHub repo for why each piece
 * is the way it is.
 * ========================================================================= */

import { initTabs, initSheets, showView, openSheet, closeSheet, toast } from "./ui.js";
import { initInstall } from "./install.js";
import { loadState, saveState, requestPersistence } from "./store.js";
import { createAccount } from "./account.js";
import { initAccountUI } from "./account-ui.js";
import { createSync } from "./sync.js";
import { COMPETITIONS, DEFAULT_COMP, mergeCompetitions } from "./sports.js";
import { getPublic, callPrivate } from "./api.js";
import { toggleFavorite, isFavorite, mergeFavorites, mergePicks, normaliseCode } from "./logic.js";
import { el } from "./dom.js";
import { createNewsView } from "./views/news.js";
import { createScorecardView } from "./views/scorecard.js";
import { createFavoritesView } from "./views/favorites.js";
import { createFantasyView } from "./views/fantasy.js";
import { createPlayersView } from "./views/players.js";
import { createSettingsView } from "./views/settings.js";
import { createDetails } from "./views/details.js";
import { openJoin } from "./views/leagues.js";

const APP_SLUG = "sportsbook";
let state = loadState();

// Declared at module scope because persist() calls it and boot() assigns it.
let sync = null;

/* ----------------------------------------------------------------------------
 * Accounts. One sign-in covers every app on the domain — see
 * setup/accounts/SETUP.md. `apiUrl` is not a secret. `appSlug` MUST match the
 * key in the service's APP_PRICES, or checkout answers "no price configured".
 *
 * The accounts origin stays the production one even when ?api= points the
 * sports data at a local server: sign-in has to happen where the cookie
 * lives, and a local sports server has no accounts of its own to offer.
 * ------------------------------------------------------------------------- */
export const account = createAccount({
  apiUrl: "https://api.thewizardofoza.com",
  appSlug: APP_SLUG,
});

function persist() {
  saveState(state);
  // Debounced, cheap, and a no-op unless signed in AND Premium.
  sync?.touch();
}

/* --- the context every view gets ------------------------------------------ */

let activeView = "favorites";
let detailOnClose = null;
let teamsPromise = null;
let leaguesPromise = null;

const ctx = {
  get state() { return state; },
  persist,
  account,
  comps: COMPETITIONS.map((c) => ({ ...c })),
  demo: false,
  leagues: [],
  teamColors: new Map(),
  toast,

  isPremium: () => account.isPaid(APP_SLUG),
  isActive: (name) => activeView === name,

  /** The competition the single-sport screens (Scorecard, Fantasy, Players)
   *  show. NFL is the starting sport; with one enabled competition this is
   *  simply it. A picker arrives with the second sport. */
  primaryComp() {
    return ctx.comps.find((c) => c.enabled && c.id === DEFAULT_COMP) ?? ctx.comps.find((c) => c.enabled) ?? COMPETITIONS[0];
  },

  toggleFavorite(kind, id) {
    state.favorites = toggleFavorite(state.favorites, kind, id);
    persist();
    return isFavorite(state.favorites, kind, id);
  },

  /** The demo-data banner. Shown on every tab while the server is running on
   *  the demo seed, so nobody mistakes invented games for real ones. */
  banner() {
    return ctx.demo
      ? el("p", { class: "demo-banner", role: "note" }, "Demo data — these games and players are not real.")
      : null;
  },

  loadTeams() {
    teamsPromise ??= getPublic(`/v1/sb/teams?comp=${encodeURIComponent(ctx.primaryComp().id)}`).then((r) => {
      const teams = r.data?.teams ?? [];
      for (const t of teams) ctx.teamColors.set(t.id, t.color);
      if (!teams.length) teamsPromise = null;     // try again next time
      return teams;
    });
    return teamsPromise;
  },

  /** The signed-in user's leagues, cached; `force` after a create/join/leave. */
  loadLeagues(force = false) {
    if (!ctx.isPremium()) { ctx.leagues = []; return Promise.resolve([]); }
    if (force) leaguesPromise = null;
    leaguesPromise ??= callPrivate("/v1/sb/leagues").then((r) => (ctx.leagues = r.leagues ?? []))
      .catch((err) => { leaguesPromise = null; throw err; });
    return leaguesPromise;
  },

  openDetail(title, content, onClose) {
    document.getElementById("detail-title").textContent = title;
    document.getElementById("detail-body").replaceChildren(content);
    detailOnClose = onClose ?? null;
    openSheet("detail-sheet");
  },
  setDetailTitle(title) {
    document.getElementById("detail-title").textContent = title;
  },
  closeDetail() {
    closeSheet("detail-sheet");
    fireDetailClose();
  },

  /** Premium is needed for `feature`: say what it is and how to get it. */
  requirePremium(feature) {
    const signedIn = account.signedIn();
    const body = el("div", { class: "form" }, [
      el("p", { class: "panel-sub" }, feature
        ? `${feature} need${feature.endsWith("s") ? "" : "s"} Sportsbook Premium.`
        : "Sportsbook Premium"),
      el("ul", { class: "benefits" }, [
        el("li", {}, "Leagues with friends — pick'em and squad-game mini-leagues"),
        el("li", {}, "Favorites, preferences and pick history saved to your account, on every device"),
        el("li", {}, "One payment of $5. No subscription, ever."),
      ]),
      el("p", { class: "fine" }, "Everything else stays free, and your data is always yours to download."),
      signedIn
        ? el("button", {
          class: "btn btn-primary", type: "button",
          onclick: () => account.startCheckout(APP_SLUG).catch((e) => toast(e.message)),
        }, "Unlock for $5")
        : el("button", { class: "btn btn-primary", type: "button", onclick: () => { ctx.closeDetail(); ctx.openAccount(); } },
          "Sign in to unlock"),
      signedIn ? el("button", {
        class: "btn", type: "button",
        onclick: async () => { await account.refresh(); if (ctx.isPremium()) { ctx.closeDetail(); ctx.refreshActive(); toast("Premium restored."); } else toast("No purchase found on this account."); },
      }, "Restore purchases") : null,
    ]);
    ctx.openDetail("Premium", body);
  },

  refreshActive() {
    views[activeView]?.render();
  },

  replaceState(next) {
    state = next;
    persist();
    ctx.refreshActive();
  },

  showBuildNumber,
  openAccount: () => {},
  openEvent: (id) => details.openEvent(id),
  openPlayer: (id) => details.openPlayer(id),
  openTeam: (id) => details.openTeam(id),
};

function fireDetailClose() {
  const fn = detailOnClose;
  detailOnClose = null;
  try { fn?.(); } catch { /* a close hook must never break the sheet */ }
}

const details = createDetails(ctx);
const views = {
  news: createNewsView(ctx),
  scorecard: createScorecardView(ctx),
  favorites: createFavoritesView(ctx),
  fantasy: createFantasyView(ctx),
  players: createPlayersView(ctx),
  settings: createSettingsView(ctx),
};

/* The competition list (and the demo flag) from the server. Rendering never
 * waits for it: the local registry is enough to draw every tab, and this
 * only refines it. */
async function loadCompetitions() {
  const r = await getPublic("/v1/sb/sports");
  if (!r.data) return;
  ctx.comps = mergeCompetitions(r.data.competitions);
  const wasDemo = ctx.demo;
  ctx.demo = !!r.data.demo;
  if (ctx.demo !== wasDemo) ctx.refreshActive();
}

/* ?join=K7Q2MX — an invite link. Opens the join sheet with the code filled
 * in and strips it from the URL, so a reload or a shared screenshot of the
 * address bar does not re-trigger it. */
function handleJoinLink() {
  let code = null;
  try {
    const url = new URL(location.href);
    code = normaliseCode(url.searchParams.get("join"));
    if (url.searchParams.has("join")) {
      url.searchParams.delete("join");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  } catch { return; }
  if (!code) return;
  showView("fantasy");
  if (ctx.isPremium()) openJoin(ctx, code);
  else {
    ctx.requirePremium("Leagues");
    toast(`Invite code ${code} — unlock Premium, then join with it.`);
  }
}

function boot() {
  // Ask to be exempt from automatic eviction. Fire-and-forget.
  requestPersistence();

  // Every view renders on arrival and may stop timers on departure.
  document.addEventListener("view:change", (e) => {
    const next = e.detail.name;
    if (next !== activeView) views[activeView]?.leave?.();
    activeView = next;
    views[next]?.render();
  });

  initSheets();
  // The kit's sheets close from ui.js; the detail sheet's close hook runs
  // whichever way it was closed (✕, backdrop, Escape).
  const detail = document.getElementById("detail-sheet");
  new MutationObserver(() => { if (detail.hidden) fireDetailClose(); })
    .observe(detail, { attributes: true, attributeFilter: ["hidden"] });

  // Favorites is the centre tab and the one the app opens on (docs/PLAN.md §1).
  initTabs("favorites");
  // Settings is a view with no tab: showView() clears every tab's active
  // state, which is correct — you are not on any of the five.
  document.getElementById("settings-btn")?.addEventListener("click", () => showView("settings"));
  initInstall({ onInstalled: () => toast("Sportsbook is on your home screen.") });

  /* --------------------------------------------------------------------------
   * Cloud save (Premium). The DEVICE stays the source of truth; this mirrors
   * it. Deleting this block must leave a working app (setup/accounts/SYNC.md).
   *
   * favorites and picks use their own merges (logic.js): per id, the newer
   * decision wins, so an un-starred team or a changed pick is not undone by
   * the other phone's older copy. settings are per device (preferLocal): a
   * phone and a tablet can want different filters.
   * ------------------------------------------------------------------------ */
  sync = createSync(account, {
    apiUrl: "https://api.thewizardofoza.com",
    appSlug: APP_SLUG,
    documents: {
      favorites: {
        read: () => state.favorites,
        write: (v) => { state.favorites = v; saveState(state); },
        merge: (local, remote) => mergeFavorites(local, remote),
      },
      picks: {
        read: () => state.picks,
        write: (v) => { state.picks = v; saveState(state); },
        merge: (local, remote) => mergePicks(local, remote),
      },
      settings: {
        read: () => state.settings,
        write: (v) => { state.settings = v; saveState(state); },
        preferLocal: true,
      },
    },
    onChange: () => ctx.refreshActive(),
  });
  sync.start();

  const accountUI = initAccountUI(account, { appName: "Sportsbook", sync });
  ctx.openAccount = () => accountUI.open();
  document.getElementById("account-btn")?.addEventListener("click", () => accountUI.open());
  account.onChange?.(() => {
    ctx.leagues = [];
    leaguesPromise = null;
    ctx.refreshActive();
    // A newly signed-in user with a squad name: link it, so mini-league
    // standings can find their points. Harmless if already linked.
    if (account.signedIn() && state.squad.handle) {
      callPrivate("/v1/sb/handles/claim", { method: "POST", handleToken: state.squad.handle.token }).catch(() => {});
    }
  });

  /*
   * NOT awaited: the app is offline-first and must paint and be usable
   * before — and whether or not — either service answers.
   */
  account.init().then(({ recoveryToken, purchase, error }) => {
    if (recoveryToken) accountUI.openReset(recoveryToken);
    if (error) toast("Sign-in did not complete. Please try again.");
    if (purchase === "done") {
      account.refresh().then(() => { toast("Premium unlocked. Thank you!"); ctx.refreshActive(); });
    }
  });
  loadCompetitions();
  ctx.loadTeams();
  handleJoinLink();

  // Register the worker after `load` so it never competes with first paint.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
}

/*
 * The build number, read from the service worker's CACHE name rather than
 * from a constant. A page served from a stale cache then reports the STALE
 * number, which is the whole point: a screenshot has to be able to date
 * itself (setup/LESSONS.md P3). Before the worker has installed there is no
 * cache yet, so it says "not installed" rather than guessing.
 */
async function showBuildNumber() {
  const node = document.getElementById("build-number");
  if (!node || !("caches" in window)) return;
  try {
    const keys = await caches.keys();
    const mine = keys.filter((k) => /^sportsbook-v\d+$/.test(k)).sort();
    node.textContent = mine.length ? mine[mine.length - 1].replace("sportsbook-", "") : "not installed";
  } catch {
    node.textContent = "unknown";
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

export { state, persist };
