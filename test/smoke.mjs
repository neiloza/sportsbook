/* ============================================================================
 * Smoke test — the regression safety net.
 *
 *   npm test
 *
 * This exists because the alternative is what the static apps have today:
 * nothing. No build step means no test harness came for free, so testing meant
 * driving a browser by hand, which is expensive enough that it never got
 * committed — and a recommendation engine or a save migration can then break
 * silently for months.
 *
 * The bar here is deliberately low and deliberately fixed: this file does NOT
 * test your app's logic. It tests that THE SHELL STILL WORKS — the app boots,
 * the tabs switch, the sheet opens and closes, the worker registers, state
 * survives a reload, and nothing throws. Those are the things that break when
 * you touch CSS or move a file, and they are the things you would never think
 * to check by hand.
 *
 * Add your own cases below the marked line as the app grows. The rule that
 * matters is that this file keeps passing.
 *
 * It serves the app itself on a random free port, so there is nothing to start
 * first and no port to collide with.
 * ========================================================================= */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png",
};

/* A static server small enough to not be a dependency. */
function serve() {
  const server = createServer(async (req, res) => {
    try {
      // normalize() collapses any ../ before it can escape ROOT.
      const rel = normalize(decodeURIComponent(req.url.split("?")[0]));
      const path = join(ROOT, rel === "/" ? "index.html" : rel);
      if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      const body = await readFile(path);
      res.writeHead(200, {
        "Content-Type": TYPES[extname(path)] || "application/octet-stream",
        // The worker must never be served from cache, or a bad one outlives
        // the deploy meant to replace it. Same reasoning as production.
        "Cache-Control": "no-store",
      }).end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

let server, browser;

/* Anything that throws below is a failure of the app, not of the harness —
 * report it as one and still print the tally, so a broken run reads the same
 * way as a failing one. */
try {

const _server = await serve();
server = _server;
const base = `http://127.0.0.1:${server.address().port}/`;

browser = await chromium.launch({
  // Pre-installed in the agent sandbox. Falls back to Playwright's own copy
  // elsewhere, so this works on a laptop too.
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
}).catch(() => chromium.launch());

const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile Safari/604.1",
});

/*
 * The accounts service is stubbed, and the default stub REFUSES every call.
 *
 * That is deliberate and is the point: these apps are offline-first, so the
 * single most valuable thing this suite can assert about accounts is that the
 * app boots, deals and stays fully usable when the service is unreachable. A
 * sign-in system that can stop the app starting has defeated the reason the
 * app was built offline-first in the first place.
 *
 * It also keeps the suite hermetic — no test ever touches the real internet.
 *
 * NOTE WHAT THIS DOES NOT PROVE. The stub is written from the same
 * understanding as js/account.js, so it cannot tell you the real service
 * agrees. Only `node setup/accounts/verify.mjs` against a deployment can.
 * See setup/LESSONS.md P5 — that exact mistake once hid a cause through
 * twelve fix attempts.
 */
let accountsReachable = false;
await ctx.route("**/api.thewizardofoza.com/**", async (route) => {
  if (!accountsReachable) return route.abort("failed");
  const url = route.request().url();
  if (url.includes("/v1/me")) {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: null, entitlements: {} }),
    });
  }
  return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
});

const problems = [];
const page = await ctx.newPage();
// A refused request to the stubbed accounts origin is the EXPECTED state for
// most of this run, and the browser logs it whether or not the app catches it.
// Everything else still counts.
const expectedNoise = (t) => /api\.thewizardofoza\.com|ERR_TUNNEL|ERR_FAILED|ERR_NAME_NOT_RESOLVED|Failed to load resource/i.test(t);
page.on("console", (m) => {
  if (m.type() === "error" && !expectedNoise(m.text())) problems.push(`console: ${m.text()}`);
});
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("response", (r) => { if (r.status() >= 400) problems.push(`${r.status()}: ${r.url()}`); });

console.log("\nshell");
await page.goto(base, { waitUntil: "networkidle" });

check("boots with exactly one view showing",
  (await page.locator(".view.active").count()) === 1);

const secondTab = page.locator(".tab").nth(1);
const wanted = await secondTab.getAttribute("data-view");
await secondTab.click();
await page.waitForTimeout(200);

/*
 * Count BEFORE reading the id. If a switch leaves the old view active too,
 * the count is the check that names the bug — and reading an attribute off a
 * selector matching two elements throws in strict mode, which would abort the
 * run with a stack trace instead of reporting the failure.
 */
const activeCount = await page.locator(".view.active").count();
check("switching leaves exactly one view active", activeCount === 1,
  activeCount === 1 ? "" : `${activeCount} views carry .active`);
check("the switched-to view is the active one",
  (await page.locator(".view.active").first().getAttribute("id")) === `view-${wanted}`);
check("active tab marks aria-current",
  (await secondTab.getAttribute("aria-current")) === "page");

console.log("\nlayout");
/*
 * The check that matters here is the one Forest's notes warn about: tall
 * content overlapping the fixed tab bar because a container lost its bottom
 * padding. So we make the page genuinely tall, scroll to the very bottom, and
 * assert the last line of content clears the bar.
 *
 * Note what is deliberately NOT asserted: that the tab bar's bottom edge
 * equals the viewport height. `.tabbar` is `position: fixed; bottom: 0`, so
 * that is true by construction whatever else is broken — it reads like a
 * geometry test and can never fail. An assertion that cannot fail is worse
 * than no assertion, because it buys confidence it has not earned.
 */
const layout = await page.evaluate(() => {
  const root = getComputedStyle(document.documentElement);
  const view = document.querySelector(".view.active");

  const probe = document.createElement("div");
  probe.id = "__probe";
  probe.style.height = "1600px";
  const tail = document.createElement("div");
  tail.id = "__tail";
  tail.textContent = "last line of content";
  view.append(probe, tail);

  window.scrollTo(0, document.documentElement.scrollHeight);

  return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const tailBox = document.getElementById("__tail").getBoundingClientRect();
    const barTop = document.querySelector(".tabbar").getBoundingClientRect().top;
    probe.remove(); tail.remove();
    done({
      hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      tailBottom: Math.round(tailBox.bottom),
      barTop: Math.round(barTop),
      bg: root.backgroundColor,
      safeB: root.getPropertyValue("--safe-b").trim(),
      tabbarH: root.getPropertyValue("--tabbar-h").trim(),
    });
  })));
});
check("no horizontal scroll", !layout.hScroll);
check("content at the bottom clears the tab bar", layout.tailBottom <= layout.barTop,
  `content ends at ${layout.tailBottom}, bar starts at ${layout.barTop}`);
check("root paints a background", layout.bg !== "rgba(0, 0, 0, 0)", layout.bg);
check("safe-area and chrome-height tokens exist", !!layout.safeB && !!layout.tabbarH,
  `--safe-b: "${layout.safeB}", --tabbar-h: "${layout.tabbarH}"`);

console.log("\ninstall offer");
// This context is an iPhone UA, so the offer must be the iOS instructions.
check("offer is visible on iOS", await page.locator("#install-btn").isVisible());
await page.locator("#install-btn").click();
await page.waitForTimeout(300);
check("sheet opens", await page.locator("#install-overlay").isVisible());
check("sheet draws the share glyph",
  (await page.locator("#install-body svg.install-glyph").count()) > 0);
await page.keyboard.press("Escape");
await page.waitForTimeout(250);
check("Escape closes the sheet", !(await page.locator("#install-overlay").isVisible()));

console.log("\nservice worker");
check("worker activates",
  (await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return r ? (r.active ? "active" : "waiting") : "none";
  })) === "active");

console.log("\nstate");
const state = await page.evaluate(async () => {
  const s = await import("./js/store.js");
  const out = {};
  localStorage.clear();

  const fresh = s.loadState();
  out.versioned = typeof fresh.v === "number";
  out.namespacedKey = /:v\d+$/.test(s.STORAGE_KEY);

  fresh.settings.sound = false;
  s.saveState(fresh);
  out.roundTrip = s.loadState().settings.sound === false;

  // The three ways a save goes bad. None may throw, all must fall back.
  localStorage.setItem(s.STORAGE_KEY, "{ not json");
  out.survivesCorrupt = s.loadState().settings.sound === true;
  localStorage.setItem(s.STORAGE_KEY, JSON.stringify({ v: 9999 }));
  out.survivesFutureVersion = s.loadState().v === fresh.v;
  localStorage.setItem(s.STORAGE_KEY, JSON.stringify({ nope: true }));
  out.survivesGarbageShape = s.loadState().v === fresh.v;

  localStorage.clear();
  const dump = s.exportState({ ...s.loadState(), settings: { sound: false } });
  out.exportImports = s.importState(dump)?.settings.sound === false;
  out.rejectsForeignExport = s.importState('{"app":"other","v":1,"state":{"v":1}}') === null;

  // Must resolve rather than throw on every browser, including ones with no
  // Storage API at all — it is called unawaited at boot, so a rejection there
  // would surface as an unhandled promise rejection.
  out.persistenceResolves = typeof (await s.requestPersistence()) === "boolean";
  return out;
}).catch((err) => {
  // A store that throws is the exact failure these cases exist to catch, so
  // it has to read as a failed check rather than a dead test run.
  check("store never throws", false, String(err).split("\n")[0]);
  return {};
});
check("key is namespaced and versioned", state.namespacedKey);
check("fresh state carries a version", state.versioned);
check("saves and reloads", state.roundTrip);
check("survives corrupt JSON", state.survivesCorrupt);
check("survives a future version", state.survivesFutureVersion);
check("survives an unrecognised shape", state.survivesGarbageShape);
check("export round-trips", state.exportImports);
check("rejects another app's export", state.rejectsForeignExport);
check("persistence request resolves, never throws", state.persistenceResolves);

console.log("\naccounts");

/*
 * The whole point of the stub above. If the app cannot survive its accounts
 * service being down, it is not offline-first however many other boxes it
 * ticks.
 */
check("boots and stays usable with the accounts service unreachable",
  (await page.locator(".view.active").count()) === 1 &&
  (await page.locator(".tab").count()) > 0);

check("the account sheet still opens when the service is down",
  await (async () => {
    const btn = page.locator("#account-btn");
    if (!(await btn.count())) return true;          // app deleted accounts: fine
    await btn.click();
    await page.waitForTimeout(120);
    const visible = await page.locator("#account-sheet:not([hidden])").count();
    const hasGoogle = await page.locator("#account-body .account-google").count();
    await page.keyboard.press("Escape");
    return visible === 1 && hasGoogle === 1;
  })());

check("signed out by default, so nothing is unlocked for free",
  await page.evaluate(() => {
    try { return !localStorage.getItem("woz:entitlements:v1"); } catch { return true; }
  }));

/* ------------------------------------------------------------------------
 * Add app-specific cases below.
 * ---------------------------------------------------------------------- */

console.log("\nsportsbook shell");

/* Reload first: the shell section above clicked a tab, so the view showing
 * now says nothing about what the app opens on. */
await page.goto(base, { waitUntil: "networkidle" });

check("opens on Favorites",
  (await page.locator(".view.active").first().getAttribute("id")) === "view-favorites");

const tabOrder = await page.locator(".tab").evaluateAll((els) => els.map((e) => e.dataset.view));
check("five tabs, in the decided order",
  tabOrder.join(",") === "news,scorecard,favorites,fantasy,players", tabOrder.join(","));

check("every tab resolves to a view",
  await page.evaluate(() => [...document.querySelectorAll(".tab")]
    .every((t) => document.getElementById(`view-${t.dataset.view}`))));

await page.locator("#settings-btn").click();
await page.waitForTimeout(120);
check("the gear opens Settings",
  (await page.locator(".view.active").first().getAttribute("id")) === "view-settings");
check("on Settings, no tab claims to be current",
  (await page.locator('.tab[aria-current="page"]').count()) === 0);

/* The palette is a decision (green, white, brown, gold), so a stray edit to
 * tokens.css that loses the brand green should fail here rather than ship. */
const palette = await page.evaluate(() => {
  const probe = document.createElement("div");
  document.body.append(probe);
  const read = (v) => { probe.style.color = `var(${v})`; return getComputedStyle(probe).color; };
  const out = { accent: read("--accent"), gold: read("--gold"), brown: read("--brown"), bg: read("--bg") };
  probe.remove();
  return out;
});
check("palette: green accent, gold, brown, white",
  palette.accent === "rgb(31, 95, 59)" && palette.gold === "rgb(201, 162, 39)" &&
  palette.brown === "rgb(122, 74, 38)" && palette.bg === "rgb(251, 250, 246)",
  JSON.stringify(palette));

console.log("\nerrors");
check("no console errors, page errors or 4xx", problems.length === 0,
  problems.slice(0, 4).join(" | "));

} catch (err) {
  check("run completed without an unexpected error", false,
    String(err).split("\n")[0]);
} finally {
  await browser?.close();
  server?.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed\n`);
process.exit(failed.length ? 1 : 0);
