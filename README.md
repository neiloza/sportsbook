# Sportsbook

Scores, results, player stats, pick'em and fantasy for NFL and soccer, in one installable app for your phone. The full plan is in [`docs/PLAN.md`](./docs/PLAN.md).

<!-- This file is the app's mission and architecture — what it is and how it
     is put together. Where development actually stands goes in CLAUDE.md.
     Keep the split; a reader who wants one rarely wants the other. -->

## Core mission

Everything a fan wants on game day, in one app that installs to the home
screen and works on a train: live and final scores, headlines, player stats,
a prediction game, and fantasy with friends. NFL first; soccer is wired and
switched off until its data source is added.

What it refuses to do: take bets, show betting odds, link to sportsbooks,
show ads, or track anyone. Pick'em and fantasy are for points only. The free
version is complete; Premium is one $5 payment for leagues with friends and
for keeping your favorites and pick history on your account.

## How it works

1. **Favorites** (the centre tab) opens first. A new user stars their teams
   right there; after that it is their feed: each team's live, next and last
   game, starred players' latest lines, starred games, headlines.
2. **News** — today's scores (live games first) and headlines, filtered by
   sport.
3. **Scorecard** — final results by week, and **Pick'em**: tap who wins each
   upcoming game, picks lock at kickoff and grade themselves, and the record,
   streaks and a week-by-week chart build up over the season.
4. **Fantasy** — the free **squad game**: eight players under a 100.0 budget
   each week, a captain for double points, a global leaderboard under an
   anonymous squad name. Premium adds private **mini-leagues**.
5. **Players** — search anyone; the profile has season stats, fantasy points
   per game and a game log.

Friends join a league by code, by the phone's share sheet (AirDrop / Quick
Share), or by scanning a QR code. See `docs/PLAN.md` §6 for why that is the
web's answer to "nearby devices".

**Where the data comes from.** The app is static; the sports data is fetched
and stored by the shared `woz-accounts` service (GameHub repo,
`setup/accounts/service/src/apps/sportsbook/`), which the app reads through
the API in [`docs/API.md`](./docs/API.md). The app keeps the last good answer
for offline use and says how old it is.

## Structure

| Path | What it is |
|---|---|
| `index.html` | The shell: head tags, topbar, views, tabbar, sheets |
| `css/tokens.css` | The palette. Retheming happens here and nowhere else. |
| `css/base.css` | Reset, page geometry, motion, focus |
| `css/components.css` | Shared shell vocabulary |
| `css/app.css` | Sportsbook's own styles |
| `js/app.js` | App entry, the shared `ctx`, cloud-save documents |
| `js/api.js` | Every API call: 20 s deadline, offline copy, never caching private answers |
| `js/logic.js` | The rules as pure functions: grading, streaks, merges, squad checks |
| `js/dom.js` | The one way DOM is built (text, never markup) and shared widgets |
| `js/sports.js` | The sport registry as the app sees it |
| `js/views/*.js` | One file per screen, plus `details.js` (sheets) and `leagues.js` |
| `js/vendor/qrcode.mjs` | QR encoder, vendored (MIT, Kazuhiko Arase) |
| `_headers` | Production CSP and cache headers (Cloudflare Pages) |
| `js/store.js` | Persistence: `sportsbook:v1` |
| `js/install.js` | Add-to-home-screen decision table |
| `js/ui.js` | View switching, sheets, toasts |
| `sw.js` | Service worker (network-first) |
| `icons/` | One SVG source, the whole generated icon set |
| `test/unit.test.mjs` | Pure-rule tests + the SHELL import-graph check |
| `test/smoke.mjs` | Browser test of the shell and every screen, against `test/fixtures/sb-api.mjs` |
| `docs/` | `PLAN.md` (decisions), `API.md` (server contract), `BUGLOG.md` |

## Running locally

```bash
npm install          # dev tools only — nothing ships to the browser
npm run serve        # then open http://localhost:8000/
```

Without a server the app shows its offline states. To see it with data, run
the Sportsbook server locally with demo data (GameHub repo,
`setup/accounts/SPORTSBOOK.md`) and open
`http://localhost:8000/?api=http://localhost:8080` — the `?api=` override is
remembered on that browser until `?api=` (empty) clears it.

The app itself has no build step. The files in this repo are the files the
browser runs. `npm install` only fetches the test runner and the icon
builder.

## Testing

```bash
npm test
```

Runs the unit tests, then boots the app in a real browser under the
production `_headers` and checks the shell (boot, tabs, sheets, worker,
store survival, offline accounts) and every screen against an API stub:
onboarding and favorites, scores and headlines (rendered as text, never
markup), results, pick'em grading, player search, the squad builder, invite
links, Premium leagues with QR, and the offline copy. `EXPECTED_CHECKS` is a
floor — raise it when adding checks.

```bash
SB_LIVE_API=http://localhost:8080 npm run test:live
```

The same journeys against a real, demo-seeded server, with no stub in
between — the only test here that fails if the app and the server disagree.

## Icons

```bash
npm run icons
```

Reads `icons/source.svg` and writes the full set — including the 192 and 512
PNGs Chrome requires for installability and the maskable copies Android
needs. Every PNG is byte-verified opaque before it is written. Never
hand-edit one; change the SVG and re-run.

## Deploying

Cloudflare Pages → `sportsbook.<domain>`.

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | **None** |
| Build command | *(empty)* |
| Build output directory | `/` |

Then one CNAME at the registrar pointing the subdomain at the `*.pages.dev`
hostname. Nameservers do not move, so nothing else on the domain is touched.

Everything at the repo root gets published, `test/` and `package.json`
included. That is harmless — they are dev-only, the browser never loads them,
and `sw.js` does not cache them — but it is worth knowing they are reachable.
