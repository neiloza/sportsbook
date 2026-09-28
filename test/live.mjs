/* ============================================================================
 * Live test — the app against a REAL Sportsbook server, no stubs.
 *
 *   SB_LIVE_API=http://localhost:8080 npm run test:live
 *
 * This is the check test/smoke.mjs cannot make: the smoke test's API stub
 * is written from docs/API.md, like the app, so it can only catch the app
 * drifting from the contract. This one runs the real routes (the GameHub
 * repo's woz-accounts, seeded with demo data — see
 * setup/accounts/SPORTSBOOK.md there) and fails if the two halves disagree.
 *
 * Skipped, loudly, when SB_LIVE_API is not set: it needs a server running.
 * The app must be served from `localhost` (not 127.0.0.1): the server's
 * CORS admits localhost origins only when started with ALLOW_LOCALHOST=1.
 * ========================================================================= */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const API = process.env.SB_LIVE_API;
if (!API) {
  console.log("SKIP  live test: set SB_LIVE_API=http://localhost:8080 with a demo-seeded server running.");
  process.exit(0);
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png" };

const server = createServer(async (req, res) => {
  try {
    const rel = normalize(decodeURIComponent(req.url.split("?")[0]));
    const path = join(ROOT, rel === "/" ? "index.html" : rel);
    if (!path.startsWith(ROOT)) return res.writeHead(403).end();
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream", "Cache-Control": "no-store" })
      .end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise((ok) => server.listen(0, "localhost", ok));
const base = `http://localhost:${server.address().port}/`;

const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" })
  .catch(() => chromium.launch());
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // The production ACCOUNTS service is out of scope here and unreachable.
  await ctx.route("**/api.thewizardofoza.com/**", (r) => r.abort("failed"));
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/thewizardofoza|ERR_FAILED/.test(m.text())) problems.push(`console: ${m.text()}`); });
  page.on("response", (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("sportsbook:v1") || "{}"));

  await page.goto(`${base}?api=${encodeURIComponent(API)}`, { waitUntil: "networkidle" });
  await page.locator(".team-toggle").first().waitFor();
  check("every NFL team is offered on first launch", (await page.locator(".team-toggle").count()) === 32);
  await page.locator(".team-toggle").first().click();
  await page.locator("button", { hasText: "Show my favorites" }).click();
  await page.locator(".fav-team .event-card").first().waitFor();
  check("a starred team shows its games", (await page.locator(".fav-team .event-card").count()) >= 1);

  await page.locator('.tab[data-view="news"]').click();
  await page.locator("#view-news .headline").first().waitFor();
  check("News has headlines", (await page.locator("#view-news .headline").count()) > 0);

  await page.locator('.tab[data-view="scorecard"]').click();
  await page.locator("#view-scorecard .section-head").first().waitFor();
  check("Scorecard has final results by week",
    /^Week \d+$/.test(await page.locator("#view-scorecard .section-head").first().textContent()));
  await page.locator("#view-scorecard .seg", { hasText: "Pick'em" }).click();
  await page.locator("#view-scorecard .pick-btn:not([disabled])").first().waitFor();
  await page.locator("#view-scorecard .pick-btn:not([disabled])").first().click();
  check("a pick on a real upcoming game is saved", Object.keys((await state()).picks ?? {}).length === 1);

  await page.locator('.tab[data-view="fantasy"]').click();
  await page.locator("#view-fantasy .slot-row").first().waitFor();
  for (let i = 0; i < 8; i++) {
    await page.locator("#view-fantasy .slot-pick").nth(i).click();
    await page.locator("#detail-sheet .picker-row").first().waitFor();
    const ok = page.locator("#detail-sheet .picker-row:not([disabled])");
    const n = await ok.count();
    // Stars for the first three slots, then cheaper players, so the lineup
    // is valid AND exercises the budget.
    await ok.nth(i < 3 ? Math.min(3, n - 1) : Math.max(0, n - 6)).click();
  }
  await page.locator("#view-fantasy .cap-btn").first().click();
  await page.locator("#view-fantasy button", { hasText: "Save lineup" }).click();
  await page.locator("#detail-sheet input").fill(`Live ${Date.now() % 100000}`);
  await page.locator("#detail-sheet button[type=submit]").click();
  await page.locator("#view-fantasy button", { hasText: "Saved" }).waitFor({ timeout: 10000 }).catch(() => {});
  check("the real server accepts a lineup the builder allowed",
    (await page.locator("#view-fantasy button", { hasText: "Saved" }).count()) === 1 && !!(await state()).squad?.handle);

  await page.locator('.tab[data-view="players"]').click();
  await page.locator("#view-players select option").nth(1).waitFor({ state: "attached" });
  await page.locator("#view-players select").selectOption({ index: 1 });
  await page.locator("#view-players .player-row").first().waitFor();
  await page.locator("#view-players .player-row").first().click();
  await page.locator("#detail-sheet .stat-tile").first().waitFor();
  check("a roster player opens with season stats", (await page.locator("#detail-sheet .stat-tile").count()) >= 4);
  await page.keyboard.press("Escape");

  check("no console errors, page errors or 4xx against the real server", problems.length === 0, problems.slice(0, 3).join(" | "));
} catch (err) {
  check("run completed", false, String(err).split("\n")[0]);
} finally {
  await browser.close();
  server.close();
}

const EXPECTED = 8;
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed\n`);
process.exit(passed === results.length && results.length >= EXPECTED ? 0 : 1);
