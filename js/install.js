/* ============================================================================
 * install.js — "Add to Home Screen", done once.
 *
 * Liberty and Popcorn independently arrived at the same four-outcome table.
 * This is that table, extracted, with the app-specific parts moved into
 * INSTALL_CONFIG so a new app only fills in its own name.
 *
 * The decision — should the button show at all, and what should tapping it do
 * — is a PURE FUNCTION of a snapshot of the browser (`installPromptKind`).
 * That is the whole design. Detection across iOS, iPadOS, Android and half a
 * dozen embedded browsers is fiddly and impossible to check by hand; as a
 * table it can be reasoned about, and unit-tested in milliseconds.
 *
 * The asymmetry between the platforms is the shape of the feature and no
 * amount of code changes it: Chrome hands you a real install dialog you can
 * trigger; Apple has never exposed a programmatic install. The best iOS
 * allows is naming the gesture clearly enough to follow. So one branch
 * installs and the other instructs, and that is not a gap waiting to be
 * filled.
 *
 * Four outcomes, in priority order:
 *   "android-prompt"   Chrome handed us a beforeinstallprompt event; tapping
 *                      opens the real install dialog.
 *   "ios-instructions" No API exists on iOS. Show the Share -> Add to Home
 *                      Screen gesture, DRAWN — the share glyph is the part
 *                      people cannot find from a text description.
 *   "in-app-browser"   Opened from Instagram/Facebook/etc. Their embedded
 *                      browsers cannot install anything — the option is not
 *                      in the menu — so point at "Open in browser" instead.
 *   "none"             Already installed, or a browser that cannot install.
 * ========================================================================= */

/* --- CONFIGURE ME -------------------------------------------------------- */
const INSTALL_CONFIG = {
  appName: "Sportsbook",
  emoji: "✨",
  storageKey: "sportsbook:installed",
};

/* --- the pure part: no DOM, no globals ----------------------------------- */

/* Embedded browsers, which have no "Add to Home Screen" anywhere in their
 * menu. A link opened from Instagram, Facebook, LinkedIn or WhatsApp lands
 * here rather than in Safari or Chrome, so for anything shared socially this
 * is a fraction of traffic rather than an edge case.
 *
 * This list WILL go stale, and it is built to fail safe: an unrecognised
 * embedded browser falls through to the ordinary platform answer, so the
 * worst case is a less helpful message rather than a broken one. */
const IN_APP_BROWSER_SIGNATURES = [
  "FBAN",           // Facebook, iOS
  "FBAV",           // Facebook, Android
  "Instagram",
  "LinkedInApp",
  "Twitter",
  "Snapchat",
  "TikTok",
  "Pinterest",
  "WhatsApp",
  "Line/",
  "MicroMessenger", // WeChat
];

export function detectInstallPlatform(ua, maxTouchPoints) {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  // iPadOS 13+ reports a desktop Safari UA. Touch points give it away.
  if (/Macintosh/i.test(ua) && (maxTouchPoints || 0) > 0) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

export function isInAppBrowser(ua) {
  return IN_APP_BROWSER_SIGNATURES.some((sig) => ua.indexOf(sig) !== -1);
}

/**
 * env: { userAgent, isStandalone, hasNativePrompt, maxTouchPoints, installed }
 * Returns one of: "none" | "android-prompt" | "ios-instructions" | "in-app-browser"
 */
export function installPromptKind(env) {
  if (env.isStandalone || env.installed) return "none";  // never ask inside the installed app
  if (isInAppBrowser(env.userAgent)) return "in-app-browser";

  const platform = detectInstallPlatform(env.userAgent, env.maxTouchPoints);
  if (platform === "ios") return "ios-instructions";

  // Android and desktop alike: only offer it when Chrome actually gave us the
  // event. Without it .prompt() does nothing, and a dead button is worse than
  // no button.
  return env.hasNativePrompt ? "android-prompt" : "none";
}

/* --- the wiring: DOM, storage, event plumbing ---------------------------- */

let deferredInstallPrompt = null;

function isStandaloneDisplay() {
  try {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch (err) { /* matchMedia can throw in odd embedders */ }
  return window.navigator.standalone === true;  // iOS predates the media query
}

function installMarkedDone() {
  try { return localStorage.getItem(INSTALL_CONFIG.storageKey) === "1"; }
  catch (err) { return false; }  // Safari private mode throws
}

function markInstallDone() {
  try { localStorage.setItem(INSTALL_CONFIG.storageKey, "1"); }
  catch (err) { /* the button just reappears next visit — not worth handling */ }
}

export function currentInstallKind() {
  return installPromptKind({
    userAgent: navigator.userAgent || "",
    isStandalone: isStandaloneDisplay(),
    hasNativePrompt: !!deferredInstallPrompt,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    installed: installMarkedDone(),
  });
}

/* The iOS share glyph, drawn. A text description of "the share button" sends
 * people hunting; the shape is recognisable instantly. */
const SHARE_GLYPH =
  '<svg class="install-glyph" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M12 3.5 8.5 7M12 3.5 15.5 7M12 3.5v11" fill="none" stroke="currentColor" ' +
  'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M6.5 11H5.2A1.2 1.2 0 0 0 4 12.2v7.1A1.2 1.2 0 0 0 5.2 20.5h13.6a1.2 1.2 0 0 0 1.2-1.2v-7.1a1.2 1.2 0 0 0-1.2-1.2h-1.3" ' +
  'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function sheetCopy(kind) {
  const { appName, emoji } = INSTALL_CONFIG;
  if (kind === "ios-instructions") {
    return {
      title: `Add ${appName} to your Home Screen`,
      sub: "It'll open full screen, with no address bar — like any other app.",
      steps: [
        `Tap ${SHARE_GLYPH} <b>Share</b> at the bottom of Safari (the top, on iPad).`,
        "Scroll down and choose <b>Add to Home Screen</b>.",
        `Tap <b>Add</b>. ${emoji}`,
      ],
    };
  }
  if (kind === "in-app-browser") {
    return {
      title: `Open ${appName} in your browser first`,
      sub: "You're in an app's built-in browser, which can't add anything to the home screen.",
      steps: [
        "Tap the <b>···</b> menu in the corner of this screen.",
        "Choose <b>Open in browser</b> (Safari or Chrome).",
        "Tap this button again there.",
      ],
    };
  }
  return null;
}

function refreshInstallButton() {
  const btn = document.getElementById("install-btn");
  if (!btn) return;
  btn.classList.toggle("hidden", currentInstallKind() === "none");
}

function openInstallSheet(kind) {
  const copy = sheetCopy(kind);
  if (!copy) return;
  const overlay = document.getElementById("install-overlay");
  const body = document.getElementById("install-body");
  if (!overlay || !body) return;

  body.innerHTML =
    `<p class="install-sub">${copy.sub}</p>` +
    `<ol class="install-steps">${copy.steps.map((s) => `<li>${s}</li>`).join("")}</ol>`;
  const title = document.getElementById("install-title");
  if (title) title.textContent = copy.title;

  overlay.hidden = false;
  document.getElementById("install-close")?.focus({ preventScroll: true });
}

function closeInstallSheet() {
  const overlay = document.getElementById("install-overlay");
  if (overlay) overlay.hidden = true;
}

async function runNativeInstallPrompt() {
  const evt = deferredInstallPrompt;
  if (!evt) return;
  // The event is single-use and consumed by prompt(), so drop our copy
  // whatever the user chooses.
  deferredInstallPrompt = null;
  try {
    await evt.prompt();
    const choice = await evt.userChoice;
    if (choice && choice.outcome === "accepted") markInstallDone();
  } catch (err) {
    console.warn(`${INSTALL_CONFIG.appName}: install prompt failed.`, err);
  }
  refreshInstallButton();
}

/* Must be attached before Chrome fires it, which happens shortly after load.
 * If your app has a loading spinner before its UI mounts, hoist this listener
 * into an inline <script> in <head> and park the event on `window` — Chrome
 * fires it once, and if nothing is listening the offer is gone for the visit. */
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();  // suppress Chrome's own mini-infobar
  deferredInstallPrompt = e;
  refreshInstallButton();
});

window.addEventListener("appinstalled", () => {
  markInstallDone();
  deferredInstallPrompt = null;
  refreshInstallButton();
  closeInstallSheet();
});

export function initInstall({ onInstalled } = {}) {
  const btn = document.getElementById("install-btn");
  if (btn) {
    btn.addEventListener("click", () => {
      const kind = currentInstallKind();
      if (kind === "android-prompt") runNativeInstallPrompt();
      else if (kind !== "none") openInstallSheet(kind);
    });
  }

  document.getElementById("install-close")?.addEventListener("click", closeInstallSheet);
  document.getElementById("install-overlay")?.addEventListener("click", (e) => {
    if (e.target.closest("[data-install-close]")) closeInstallSheet();
  });
  document.addEventListener("keydown", (e) => {
    const overlay = document.getElementById("install-overlay");
    if (e.key === "Escape" && overlay && !overlay.hidden) closeInstallSheet();
  });

  if (onInstalled) window.addEventListener("appinstalled", onInstalled);

  // Launching from the installed icon should hide the button even in a tab
  // that was already open when the install happened.
  try {
    window.matchMedia("(display-mode: standalone)")
      .addEventListener("change", refreshInstallButton);
  } catch (err) { /* older Safari has no addEventListener on MediaQueryList */ }

  refreshInstallButton();
}
