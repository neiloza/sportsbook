# Sportsbook — development notes

This file is for sessions picking up work on Sportsbook. Read
[`README.md`](./README.md) first for the app's mission — this file tracks
*where development actually stands*.

## Before you debug anything

Three things, in this order. Each one is a debugging round somebody already
lost:

1. **Get the build number off the device.** It is in the toolbar and in
   Settings. A screenshot that cannot date itself is not evidence — it cannot
   tell a live bug from a stale install, and the service worker means a deploy
   lands a launch later.
2. **Read [`docs/BUGLOG.md`](./docs/BUGLOG.md).** The thing you are about to
   try may already be in there marked *RULED OUT* or *MADE IT WORSE*.
3. **Look your symptom up in `setup/LESSONS.md` in the GameHub
   repo** — bugs already found and paid for, indexed by symptom rather than by
   cause, because in nearly every one of them the symptom and the cause were
   in different parts of the app.

And when you write up what you did: **finding a mechanism is not confirming a
cause.** Say which one you have.

## Current status (as of 2026-09-28)

**Phases 0–5 of [`docs/PLAN.md`](./docs/PLAN.md) are built, with NFL as the
starting sport.** Nothing has run against a real data provider or a
deployed server yet — see *Waiting on a human*.

The app (this repo):
- **Five tabs**, all working against the API in [`docs/API.md`](./docs/API.md):
  News (scores + headlines, sport filter), Scorecard (results by week +
  Pick'em), Favorites (onboarding team picker, then a feed), Fantasy (squad
  game + mini-leagues), Players (search + profile). Settings behind the gear.
- **Pick'em** is local-first: picks lock at kickoff, grade themselves when the
  app sees the final, and feed a record / streak / weekly chart. A Premium
  user's picks are also sent to their pick'em leagues, where the server
  enforces the lock.
- **Squad game** (free, budget style, adapted from the soccer design because
  NFL came first): QB, 2 RB, 3 WR, TE, FLEX under 100.0, max 3 per team,
  captain ×2, locks at the week's first kickoff. Anonymous handle, global
  leaderboard.
- **Premium** (sign-in + $5): pick'em leagues and squad mini-leagues (create,
  join by code / `?join=` link / share sheet / QR), and cloud save of
  favorites, picks and settings with per-id newest-wins merges.
- **Offline:** every public read falls back to the last good answer, marked
  "offline". Private answers are never cached.
- **Tests:** `npm test` = 18 unit tests + 56 browser checks under the real
  `_headers` CSP, against a contract-derived stub.

The server (GameHub repo, `setup/accounts/service/src/apps/sportsbook/`,
branch `claude/eager-gates-uegaim`): see `setup/accounts/SPORTSBOOK.md`
there. Built inside `woz-accounts` (decision D7) with an `ingest` process
group, an ESPN adapter, and a demo-data seed.

**Not built:** soccer data (competitions are registered but disabled), NFL
snake-draft leagues (Phase 6), push notifications, the licensed-provider
adapter.

## Open issues

- **The ESPN adapter has never seen a real ESPN response.** This sandbox's
  network policy blocks the host, so the adapter and its fixtures were
  written from the same understanding — a regression guard, not evidence
  (LESSONS P5). The probe script in GameHub settles it.
- **The API stub in `test/fixtures/sb-api.mjs` is written from `docs/API.md`**,
  as the app is. It catches the app drifting from the contract; only the
  server's integration test (GameHub) catches the server drifting.
- **The CSP blocks `?api=` overrides in production** (connect-src lists one
  origin). Deliberate: the override is for local development, where
  `_headers` is not applied by `npm run serve`.
- **Squad-game rules exist twice**: the server validates (authoritative);
  `logic.js` mirrors them only to grey out impossible picks. A drift costs a
  confusing server message, never a wrong lineup.

## What to do next

1. Run the ESPN probe from a networked machine (see Waiting on a human) and
   fix whatever the adapter got wrong, before anything else touches data.
2. Phase 6: NFL snake-draft leagues (SSE draft room, rosters, lineups,
   matchups) — the Fantasy tab already says it is coming.
3. Soccer: enable `eng.1` etc. in the server registry once its adapter is
   written and probed; the app picks it up with no release. Draw picks are
   already supported.
4. Swap the ESPN adapter for a licensed provider before public launch
   (docs/PLAN.md §4).

## Waiting on a human

**Everything here is blocked on something an agent cannot do from a sandbox: a
credential, a file that needs downloading, a judgement call, or a check against
the real world. Nothing in this list is waiting on code.**

That sentence is the entry test. If a capable agent with this repo and no
outside access could finish it, it does not belong here — it belongs in "What
to do next". Mixing the two is what makes both lists ignorable: the agent
cannot act on half of one, and the human cannot find their half in the other.

Ordered by leverage: the top unlocks the most for the least effort. Mark
anything recurring, and never tick those off.

**How to write an entry.** A bare line like "set up hosting" rots within a
month, because the person reading it six weeks from now has lost the context
you have right now. Each entry carries:

1. A **bold one-line summary** of the action.
2. **What it unlocks, or what stays broken without it** — the reason this is
   worth a human's attention rather than a note.
3. **Why an agent cannot do it** — no credential, no network, needs a device,
   needs a decision.
4. **The exact commands or clicks**, so it is executable without re-derivation.
5. **Any trap** that silently produces a wrong result rather than an error.

Delete an entry when it is genuinely done, not when it is half done. A ticked
box that is not true is worse than an open one.

<!-- The three below are real: a freshly scaffolded app is blocked on all of
     them. Delete each as you complete it. -->

- [ ] **Run the ESPN probe from a machine with internet access.** The data
      adapter has never parsed a real ESPN response — this sandbox cannot
      reach ESPN — so every field path in it is an assumption. Until this
      runs, "the scores are right" is unverified.
      *Agent cannot: network policy blocks site.api.espn.com.*
      1. In the GameHub repo: `cd setup/accounts/service && npm install`
      2. `node scripts/sportsbook-probe.mjs` — it fetches the live endpoints,
         runs the real adapter, and prints what parsed and what came back
         empty.
      3. Paste the output into a session and have the adapter fixed.
      Trap: a field that parses to `0` rather than failing looks healthy.
      Read the probe's per-field counts, not just its exit code.

- [ ] **Merge the GameHub branch `claude/eager-gates-uegaim`** once reviewed.
      The whole server half of this app lives there; until it is on `main`,
      a deploy of `woz-accounts` does not include Sportsbook.
      *Agent cannot: merging to another repo's main is your call.*

- [ ] **Deploy `woz-accounts` for the first time, with the ingest process.**
      No live data reaches the app until this happens — it has never been
      deployed (GameHub `setup/README`). Follow `setup/accounts/SETUP.md`,
      then `fly scale count ingest=1` so exactly one poller runs.
      Trap: two ingest machines is safe (an advisory lock makes the second
      idle) but wasted money.

- [ ] **Choose and pay for a licensed data provider before anyone else uses
      the app.** ESPN's endpoints are undocumented and Disney's terms forbid
      automated and commercial use — fine for a private build, not for a
      public one. Front-runner: BALLDONTLIE (≈ $9.99/sport/month, allows
      fantasy use; verify current pricing). Put the key in `fly secrets`,
      never in a repo.

- [ ] **Create the hosting project and point the subdomain at it.** Until this
      exists there is no URL, so nothing here can be installed to a phone or
      tested on a real device — which blocks the iPhone check below.
      Needs dashboard and registrar logins that an agent has no access to.
      1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to
         Git** → pick this repo.
      2. Framework preset **None**, build command **empty**, output directory
         **`/`**. This repo has no build step; all three are deliberately "do
         nothing".
      3. Note the `*.pages.dev` hostname it assigns.
      4. At the registrar, add a CNAME for `sportsbook` pointing at that
         hostname.
      Do not move the domain's nameservers. Other apps share this domain, and
      adding a subdomain must stay a single CNAME that touches nothing else.

- [ ] **Install it on a real iPhone and a real Android phone, and use it.**
      This is the one thing no test can cover. The smoke test drives a desktop
      Chromium with a phone-sized viewport: `env(safe-area-inset-*)` is zero
      there, so notch and home-indicator bugs are invisible; and the iOS
      "Share → Add to Home Screen" gesture cannot be exercised headlessly at
      all, so the entire `ios-instructions` branch of `js/install.js` is
      unverified until a person follows it.
      1. Open the deployed URL in Safari on an iPhone, follow the app's own
         install instructions, and check the sheet's wording matches what
         Safari actually shows.
      2. Launch from the home-screen icon. Confirm no address bar, the status
         bar tint matches the app, and nothing hides under the notch or the
         home indicator.
      3. Repeat on Android in Chrome, where the install is a real dialog.
      4. Add data, force-quit, reopen. Confirm it survived.
      Do this before telling anyone about the app, not after.

- [ ] **Register this app with the shared accounts service.** Delete this
      entry if Sportsbook will have no sign-in and no paid tier. Otherwise
      the app cannot sign anyone in or take a payment until a human does all
      four, and each one fails in its own confusing way if skipped.
      *Agent cannot: three separate dashboard logins.*
      1. Google Cloud Console → the shared OAuth client → add
         `https://sportsbook.<domain>` **and** your local dev origin with its
         port to **Authorized JavaScript origins**. Missing: an error in the
         console and nothing at all on screen.
      2. Apple Developer → the shared Services ID → add the domain and return
         URL, then serve `apple-developer-domain-association.txt` from
         `/.well-known/` in this repo.
      3. Stripe → one **Product** for Sportsbook with one **Price** at $5,
         in **both** test and live mode. Put the price ids in the service's
         config, never in this repo.
      4. Add `https://sportsbook.<domain>` to the API's CORS allowlist.
      Trap: the Google consent screen must be **published**, not left in
      Testing — in Testing mode only listed accounts can sign in and everyone
      else gets a generic error that does not say why.
      Trap: a Stripe **test** key with a **live** price id (or the reverse)
      fails with "no such price", which reads like a typo rather than like a
      mode mismatch.

- [ ] *(recurring — never tick)* **Re-read this list when you pick the project
      back up.** Entries go stale silently: a credential gets created, a
      decision gets made in your head, a step gets done on a phone and never
      recorded. An out-of-date blocker list sends the next session chasing work
      that is already finished.

## File map

<!-- Every file that matters, one line each, saying what it owns. This is
     what a fresh session reads instead of grepping. -->

| File | Owns |
|---|---|
| `index.html` | Shell: head tags, topbar, views, tabbar, sheets |
| `css/tokens.css` | The palette. Retheming happens here and nowhere else. |
| `css/base.css` | Reset, safe areas, dvh, motion, focus |
| `css/components.css` | Shared shell vocabulary |
| `css/app.css` | Sportsbook's own styles: every screen component |
| `js/app.js` | App entry, the shared `ctx`, cloud-save documents |
| `js/api.js` | Every API call: 20 s deadline, offline copy, private answers never cached |
| `js/logic.js` | Pure rules: grading, streaks, favorites/picks merges, squad checks, codes |
| `js/dom.js` | `el()` (text, never markup), event card, badges, shared widgets |
| `js/sports.js` | Sport registry as the app sees it (server decides `enabled`) |
| `js/views/news.js` · `scorecard.js` · `favorites.js` · `fantasy.js` · `players.js` · `settings.js` | One screen each |
| `js/views/details.js` | Game / player / team sheets, openable from any tab |
| `js/views/leagues.js` | Premium leagues: create, join, invite (share, QR, code), standings |
| `js/vendor/qrcode.mjs` | QR encoder, vendored unmodified (MIT, Kazuhiko Arase, v2.0.4) |
| `_headers` | Production CSP + cache headers; the smoke test serves through it |
| `test/unit.test.mjs` | Pure-rule tests + SHELL import-graph check |
| `test/smoke.mjs` · `test/fixtures/sb-api.mjs` | Browser checks + the contract-derived API stub |
| `docs/API.md` | The contract with the server. Change both halves AND this file |
| `js/store.js` | Persistence: `sportsbook:v1`, migrations |
| `js/install.js` | Add-to-home-screen decision table + sheet |
| `js/ui.js` | View switching, sheets, toasts |
| `sw.js` | Service worker (network-first) |
| `icons/build-icons.cjs` | One SVG in, the full icon set out |
| `docs/PLAN.md` | The build plan and decision log |
| `docs/BUGLOG.md` | Every attempt at a recurring bug, and how each turned out |

## Invariants — do not break these

<!-- The things that will silently corrupt data or break a platform if
     someone "cleans them up". Write the reason, not just the rule. -->

### The store

- **State key is `sportsbook:v1`.** Bump the version AND add a migration in
  `store.js` if the shape changes incompatibly. Deleting an old migration
  strands anyone who has not opened the app since — which, with no backup,
  means losing their data permanently.
- **`normalise()` spreads the defaults UNDER the stored state, never over
  it.** That is the property that makes a default safe to change at all: a new
  default only reaches devices that have never saved one. Merged the other
  way, every such change would silently rewrite what people had chosen.
- **A new field needs a default even when it needs no version bump.** A field
  added to a filter, absent from an older save, is `undefined` — and an
  `undefined` compared against every record matches none, so the user's
  content comes back **completely empty** with the UI looking perfectly
  normal. Add it to `defaultState`; the rule above does the rest.
- **A save from a FUTURE version is left alone, not migrated.** Someone opened
  a newer deploy on another device and then an older cached one here. Return
  `null` and run on defaults rather than corrupting the newer save.
- **Store decisions, never content.** Maps of `id → timestamp`; references by
  id. A content fix in a later deploy then reaches everyone without touching
  their data, and a full backup stays a few kilobytes.
- **Content ids are permanent.** Rename by changing the display name, never
  the `id` — the id is what saves and references point at.
- **Renaming the app renames the storage key, which abandons everyone's
  data.** Keep a `LEGACY_KEYS` list, read an old key only when the current one
  is genuinely absent, and leave the old key in place.
- **An enum value the UI no longer recognises reads as lost data.** A record
  whose category no longer exists renders nowhere at all. Translate legacy
  values once, on load, with a catch-all fallback.

### Sportsbook's own

- **API text is rendered as text.** Headlines come from a third-party feed;
  `el()` in `js/dom.js` turns string children into text nodes. Never build
  markup from API data with `innerHTML` — the smoke test plants an `<img
  onerror>` headline to catch exactly that.
- **Only public answers are cached, and never an empty one.** `getPublic`
  writes the `sportsbook-data` cache; `callPrivate` never does. An empty
  answer is not cached, so "the network failed" cannot become "no games".
- **`sw.js` spares `sportsbook-data` on activate.** Deleting it on each deploy
  would throw away everyone's offline copy.
- **A graded pick is written once.** A later stat correction does not flip a
  pick back and forth; history is what the app saw at the final.
- **Favorites are id → { on, at } with tombstones**, and cloud save merges
  them newest-wins per id (`mergeFavorites`). Deleting keys instead of
  writing `on: false` brings un-starred teams back from the other device.
- **The server is authoritative for squad lineups and league-pick locks.**
  The app's checks are UX hints; never skip the server call because the
  client "already validated".

### The worker and the deploy

- **Do not add large assets to the service worker's SHELL list.** SHELL blocks
  activation, so every install pays for them. Precache them **after
  `clients.claim()`** instead.
- **Do not rely on the fetch handler to cache your app's modules.** On a first
  visit the page issues its imports **before** the worker takes control, so
  the handler never sees them — and the app works perfectly until somebody
  installs it and opens it on a plane. Every module belongs in `SHELL`; verify
  it by walking the import graph rather than by remembering.
- **The worker's cross-origin handler must never reject.** A rejected promise
  passed to `respondWith()` is a network error, and in an `<img>` that is a
  blank frame with nothing in the *page* console. Every step that can throw
  (opening the cache in private mode, `cache.put` on an opaque response) falls
  back to a plain fetch.
- **`sw.js` is served `no-store`.** Otherwise a broken app survives the deploy
  meant to fix it, and the only user-side cure is clearing site data.
- **Adding a third-party origin means `connect-src` AND `img-src` in
  `_headers`.** The CSP applies to `sw.js` too, and inside the worker an image
  is a `fetch()`, not an `<img>`. Get this wrong and every local test passes,
  no violation fires in the page, and the feature breaks **in production
  only**.
- **Never trust a third-party URL verbatim.** Normalise host and query at the
  one seam where an API answer becomes a URL this app uses — a vendor can
  answer with a hostname its own docs did not mention, and a trailing
  `?utm_source=…` silently breaks any string rewrite anchored to the end.

### Touch

- **Every `:hover` rule stays inside `@media (hover: hover)`.** iOS Safari
  sticks `:hover` to the last-tapped element, so the next element rendered
  into that slot inherits a highlight it never earned.
- **No global flag may span an exit animation.** A module-wide `busy` held for
  a 320ms flight means a gesture begun inside that window never starts — no
  capture, no drag, nothing on screen to say why. Reported as *"I have to
  swipe twice."* Take the decision immediately, make the flight cosmetic, and
  guard a second decision **on the element, never on the module**.
- **A cancelled gesture is still a gesture.** With `touch-action: pan-y` the
  browser can steal a pointer mid-swipe, and a real thumb arcs, so the ones it
  steals are most of them. `pointercancel` must commit if the drag had already
  earned a decision.
- **A swipeable row inside a scrolling list locks to one axis** on the first
  move past a slop threshold, and lets go *completely* if the gesture is more
  vertical than horizontal. Otherwise the list resists a thumb going down the
  screen — a bug nobody can describe.
- **Pointer capture retargets every later event to the captor**, so a listener
  on a child never runs and a `click` handler fires too late. Route a tap by
  remembering `pointerdown`'s target in the gesture handler.

### Dates

- **Never `new Date("YYYY-MM-DD")`.** It parses as UTC midnight and prints in
  local time, so west of Greenwich it is the previous day. Keep dates as
  strings until the last possible moment and compare ISO strings
  lexicographically.

### Icons

- **Icons are generated, never hand-edited.** Change `icons/source.svg` and
  re-run `node icons/build-icons.cjs`. The builder byte-verifies that every
  PNG came out fully opaque and refuses to write one that did not — an icon
  with alpha reaches a home screen as a clipped mark or a see-through tile,
  and hand-editing a PNG bypasses the check entirely.
- **An icon whose real pixel size disagrees with the manifest makes the app
  silently uninstallable.** Chrome checks the *declared* size. Nothing warns.

### Accounts and money — delete this block if the app has neither

<!-- See setup/INFRASTRUCTURE.md in the GameHub repo. Fill in the
     free/paid line for THIS app; it is the decision a future session will
     otherwise re-derive differently and sensibly. -->

- **The free version is complete. Export is never gated. The unlock is one
  payment, forever.** For Sportsbook specifically, free gets: all five tabs,
  favorites and preferences stored on the device, solo pick'em and its local
  history, and the Premier League squad game against yourself and the global
  leaderboard (anonymous handle, no account). The $5 unlock adds the
  personalized account (favorites, preferences and pick history saved and
  synced), NFL fantasy leagues, league pick'em and private soccer
  mini-leagues. Decided 2026-09-28; see docs/PLAN.md §7.
- **No real money, ever.** Pick'em and fantasy are points only: no wagering,
  no betting odds, no affiliate links, whatever the repo is called.
- **No sign-in wall on first launch.** An account carries a *purchase* between
  devices; it does not gate the product.
- **The app must boot, and stay fully usable, with the API unreachable and
  nobody signed in.** Asserted in the smoke test.
- **A cached entitlement never expires into "unpaid".** "Could not reach the
  server" and "has not paid" arrive looking identical, and persisting the
  second when you meant the first downgrades a paying customer on a train.
  Cache a positive answer durably and a negative one weakly.
- **The Stripe webhook grants the entitlement, never the success URL.** A URL
  is a string anyone can type.

## Conventions

- No build step, no framework, no bundler. Plain HTML/CSS/JS served as files.
- No analytics, tag managers, session recorders, error-reporting SaaS or ads.
  Sign-in and payment are the only third-party origins, they load **on tap
  rather than in `<head>`**, and a free user who never signs in makes zero
  third-party requests.
- Comments explain *why*. If a future session could plausibly "clean this up"
  and reintroduce a bug, write the paragraph.
- **When a bug comes back a second time, it gets an entry in
  [`docs/BUGLOG.md`](./docs/BUGLOG.md) BEFORE it gets a fix.** Write the
  hypothesis and the change, then come back and write what actually happened
  — including *made it worse* and *ruled out*, which are the two outcomes
  that save the next session the most time.
- **One source of truth for any rule two programs share.** A script that
  reimplements the app's rules will drift, and *"a comment asking whoever
  changes one to change the other is a promise nobody keeps."* Import the
  module; read the constant from whatever owns it.
- **A stub cannot falsify the belief that produced it.** Where this app
  depends on a third party the test environment cannot reach, the stub is a
  regression guard and **not evidence about the third party**. Say so in a
  comment at the top of it, and label any unverified claim about that API as
  an assumption rather than stating it as fact.

## Testing

<!-- Serve the folder and drive it with Playwright:
       python3 -m http.server 8137
     Chromium is at /opt/pw-browsers/chromium in the agent sandbox; do not run
     `playwright install`.

     Checks that catch real bugs:
     - Visual at 390x844, deviceScaleFactor 2 — and again at 375x667, since
       tall content overlaps the fixed tab bar if a scroll area is missing
       overflow-y.
     - State machine: dispatch visibilitychange / blur / focus / pagehide.
     - Reload with a populated localStorage to exercise migrations. -->

Four rules for extending `test/smoke.mjs`, each of which cost another app on
this kit real time:

- **Every assertion must be able to fail.** Break the thing it guards and
  watch it go red before you trust it. An assertion that cannot fail is worse
  than no assertion, because it buys confidence it has not earned.
- **Raise `EXPECTED_CHECKS` when you add checks.** It is a floor, not a total:
  a run that dies half way still prints a tally, and *"58/61 passed"* reads
  almost exactly like a healthy run. That nearly shipped a broken feature.
- **Assert the promise, not the mechanism.** Tests that asserted *how* the app
  achieved a result went red against data that was working perfectly, the
  moment an optimisation changed the how.
- **Wait for a state, never sleep** — and beware a finish condition that is
  also the resting state, which matches before the handler has done anything.

Serve the suite through the **real production `_headers`**. The policy is
strict enough to break the app, and the alternative is finding out on a phone
with no console open.

Chromium is at `/opt/pw-browsers/chromium` in the agent sandbox — do **not**
run `playwright install` there. **On a laptop you do need it once** (`npx
playwright install chromium`), or the suite dies at `browserType.launch` and
prints `0/2 passed`, which looks far more alarming than it is.

## Deploy

Cloudflare Pages → `sportsbook.<domain>`. Framework preset **None**, build
command empty, output directory `/`. DNS stays at the registrar; adding the
subdomain is one CNAME and touches nothing else on the domain.
