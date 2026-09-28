/* ============================================================================
 * app.js — where your app actually starts.
 *
 * The kit's job ends here. Everything above this line (shell, install, store,
 * service worker) is plumbing that is already correct; everything below is
 * yours.
 * ========================================================================= */

import { initTabs, initSheets, showView, toast } from "./ui.js";
import { initInstall } from "./install.js";
import { loadState, saveState, requestPersistence } from "./store.js";
import { createAccount } from "./account.js";
import { initAccountUI } from "./account-ui.js";
import { createSync } from "./sync.js";

const state = loadState();

// Declared at module scope because persist() calls it and boot() assigns it.
let sync = null;

/* ----------------------------------------------------------------------------
 * Accounts. One sign-in covers every app on the domain — see
 * setup/accounts/SETUP.md. Delete this, the import above, the #account-sheet
 * block in index.html and css/account.css if this app will have no accounts.
 *
 * `apiUrl` is not a secret and is meant to ship in the browser.
 * `appSlug` MUST match the key in the service's APP_PRICES, or checkout
 * answers "no price configured" and nobody can buy anything.
 * ------------------------------------------------------------------------- */
export const account = createAccount({
  apiUrl:  "https://api.thewizardofoza.com",
  appSlug: "sportsbook",
});

function persist() {
  saveState(state);
  // Debounced, cheap, and a no-op when signed out. Safe to call on every write.
  sync?.touch();
}

function boot() {
  // Ask to be exempt from automatic eviction. Fire-and-forget: the answer
  // changes nothing we do, and there is no fallback to run if it is "no".
  requestPersistence();

  // Favorites is the centre tab and the one the app opens on (docs/PLAN.md §1).
  initTabs("favorites");
  // Settings is a view with no tab: showView() clears every tab's active
  // state, which is correct — you are not on any of the five.
  document.getElementById("settings-btn")?.addEventListener("click", () => showView("settings"));
  showBuildNumber();
  initSheets();
  initInstall({
    onInstalled: () => toast(`Sportsbook is on your home screen.`),
  });

  /* --------------------------------------------------------------------------
   * Cloud save. The DEVICE stays the source of truth; this mirrors it to the
   * account so data survives a lost phone and appears on a second device.
   *
   * Deleting this block must leave a working app — that is the test of whether
   * the mirror has quietly become the original. See setup/accounts/SYNC.md.
   *
   * Name one document per logical bundle, not one per record. The default
   * merge UNIONS id-keyed maps, which is why house rule 5 says to store
   * decisions (id -> timestamp) rather than content: two devices that were
   * both offline then keep each other's work instead of one silently winning.
   * ------------------------------------------------------------------------ */
  sync = createSync(account, {
    apiUrl: "https://api.thewizardofoza.com",
    appSlug: "sportsbook",
    documents: {
      // Replace with this app's real bundles. `settings` is here because every
      // app has some, and `preferLocal` because a phone and a laptop legitimately
      // want different preferences — unlike saved items, which should union.
      settings: {
        read:  () => state.settings,
        write: (value) => { state.settings = value; saveState(state); },
        preferLocal: true,
      },
    },
    onChange: () => { /* remote data arrived — redraw whatever shows it */ },
  });
  sync.start();

  const accountUI = initAccountUI(account, { appName: "Sportsbook", sync });
  document.getElementById("account-btn")?.addEventListener("click", () => accountUI.open());

  /*
   * NOT awaited, and that is deliberate: the app is offline-first and must
   * paint and be usable before — and whether or not — the accounts service
   * answers. A sign-in system that can stop the app booting has defeated the
   * point of building it offline-first.
   */
  account.init().then(({ recoveryToken, purchase, error }) => {
    if (recoveryToken) accountUI.openReset(recoveryToken);
    if (error) toast("Sign-in did not complete. Please try again.");
    if (purchase === "done") {
      account.refresh().then(() => toast("Unlocked. Thank you!"));
    }
  });

  // Register the worker after `load` so it never competes with first paint.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  // ---- your app starts here ----
}

/*
 * The build number, read from the service worker's CACHE name rather than
 * from a constant. A page served from a stale cache then reports the STALE
 * number, which is the whole point: a screenshot has to be able to date
 * itself (setup/LESSONS.md P3). Before the worker has installed there is no
 * cache yet, so it says "not installed" rather than guessing.
 */
async function showBuildNumber() {
  const el = document.getElementById("build-number");
  if (!el || !("caches" in window)) return;
  try {
    const keys = await caches.keys();
    const mine = keys.filter((k) => k.startsWith("sportsbook-v")).sort();
    el.textContent = mine.length ? mine[mine.length - 1].replace("sportsbook-", "") : "not installed";
  } catch {
    el.textContent = "unknown";
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

export { state, persist };
