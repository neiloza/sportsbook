# Sportsbook — build plan

*Drafted 2026-09-28. Status: **decisions taken, ready for Phase 0** — see
[Decision log](#decision-log). Nothing is built yet.*

Built to the house rules in `neiloza/GameHub` → `setup/` (called **setup/**
below). Where this plan departs from them it says so and says why, per
setup/README: "a rule that gets broken deliberately gets its reason written
down".

---

## 1. What it is

A phone-first, installable sports app for fans. It covers scores, results,
player stats, a free prediction game, and fantasy. Five tabs, left to right:

| # | Tab | Job |
|---|---|---|
| 1 | **News** | What is happening *now*: live and today's scores, plus headlines. Filterable by sport |
| 2 | **Scorecard** | What *happened*: final results over the past weeks, by sport and week. Home of **Pick'em** (predict winners, track your record over time) |
| 3 | **Favorites** *(centre, opens on launch)* | Everything you starred — teams, sports, players, games — in one feed |
| 4 | **Fantasy** | NFL leagues with friends (snake draft); soccer squad game (budget-style) |
| 5 | **Players** | Search any player: bio, season stats, game log |

**Sports at launch: NFL and soccer.** Soccer means Premier League, MLS and
Champions League for scores, news and pick'em; soccer fantasy is Premier
League only. The code is **multi-sport from day one**: a sport registry and
per-sport adapters. Adding NBA, MLB, NHL, golf or college football later is
configuration plus an adapter, not a redesign.

**No real money, ever.** Pick'em and fantasy are points only: no wagering, no
betting odds, no affiliate links. Rule 7 (no dark patterns) makes that the
default. The repo name means someone will eventually suggest otherwise, so it
goes in `CLAUDE.md` Invariants on day one.

## 2. The server: sportsbook lives inside `woz-accounts`

Every house app so far keeps data on the device with no server of its own.
This one has two kinds of data that cannot work that way:

1. **Sports data** is third-party, changes by the minute, and eventually
   needs a paid API key. A key never goes client-side (LESSONS 8.9), and
   rule 7 forbids a free user's device from calling a third party at all.
2. **Leagues and leaderboards** are shared between users. The shared service's
   `app_data` table is strictly per-user. SYNC.md "When to break this rule"
   says cross-user features get purpose-built tables *alongside* it.

**Decision (D7): all of it goes into the shared service, `woz-accounts`**
(`setup/accounts/service` in the GameHub repo, `api.thewizardofoza.com`).
This keeps setup/INFRASTRUCTURE's "one shared service for every app" intact.
The app itself stays a static PWA with zero runtime dependencies. What this
means in practice:

- **Server code lives in the GameHub repo**, not this one:
  `setup/accounts/service/src/apps/sportsbook/` plus migrations `0003_…`
  onward. This session has read-only access to GameHub. **Building the server
  needs GameHub added with push access** (Waiting on a human).
- **Isolation inside one service.** Polling a sports feed every 30 s on game
  day must not slow down sign-in for every other app. The fix is a Fly
  **process group**: one codebase and one deploy, but `fly.toml` runs a `web`
  process (HTTP, as today) and a separate `ingest` process (the scheduler) on
  its own machine. A runaway poller then cannot take the sign-in machine with
  it. Everything sportsbook-specific sits under `src/apps/sportsbook/`, so the
  auth and Stripe code are not touched.
- **No new runtime dependencies.** The service's `package.json` says *"every
  package added here is one more thing to patch… keep the list short."* The
  plan needs none: Node 22 `fetch` for providers, server-sent events on plain
  `node:http` for the draft room, and a small hand-written RSS parser for the
  known feeds.
- **Identity is free.** Sportsbook routes call the existing `currentUser(req)`
  and `entitlementsFor(user.id)` directly, and the premium check is the
  existing `entitlements` row for `app_slug = 'sportsbook'`.
- **The catch: the shared service has never been deployed** (setup/README:
  "It has not been run yet"). Sportsbook's whole data layer now waits on that
  first deploy. Phases 0, 2 and 3 can be built against a local copy and
  recorded data in the meantime.

## 3. Architecture

```
sportsbook.thewizardofoza.com     static PWA (Cloudflare Pages)  ← this repo
   │  fetch, credentials:"include"
   └──► api.thewizardofoza.com    woz-accounts (Fly.io)           ← GameHub repo
          ├── web process:    auth · $5 unlock · cloud save        (existing)
          │                   /v1/sb/* read API + leagues + fantasy (new)
          ├── ingest process: scheduler → provider adapters, RSS    (new)
          └── Postgres:       existing tables + sb_* tables         (new)
```

**This repo:**

```
sportsbook/
  README.md, CLAUDE.md     rules 11 / 11b (CLAUDE.md carries Waiting on a human)
  docs/PLAN.md             this file, moved here in Phase 0
  docs/BUGLOG.md           rule 14
  index.html, sw.js, manifest.webmanifest, css/, js/, icons/, test/
                           the PWA, scaffolded at the root by new-app.sh
  js/sports.js             sport registry (shared shape with the server)
```

The PWA sits at the repo root, the kit's native layout, because there is no
server code here any more. Cloudflare Pages deploys the root.

## 4. Data: sourcing, storing, updating

### Provider (D1): free now, licensed before launch

| Stage | Provider | Why |
|---|---|---|
| **Development** | ESPN's unofficial JSON endpoints (`site.api.espn.com`) | $0; covers NFL, all three soccer competitions, per-player box scores and a news endpoint |
| **Before anyone outside you uses it** | A licensed provider. Front-runner: **BALLDONTLIE**, about $9.99 per sport per month (NFL, EPL, MLS, UCL ≈ $40/mo), with a $39.99 tier if live in-game box scores are needed | Its terms explicitly allow commercial and fantasy use, and it has per-game player stats |

**Know what the dev stage is.** ESPN's endpoints are undocumented and can
change or vanish without notice. Disney's terms prohibit automated access and
commercial use. That is acceptable for a private build and **not acceptable
once the app is public**. The switch is a launch blocker, and it goes in
*Waiting on a human* so it cannot be forgotten.

*Prices are from search results. The research could not open the vendors'
pages, so re-check before paying (verify this).*

Other options researched: TheSportsDB ($9/mo, no player box scores), API-Sports
(licence grants no publishing rights), football-data.org (soccer only, free
tier non-commercial), and SportsDataIO / Sportradar (quote-only, hundreds or
more per month).

**What makes the switch cheap:** every provider call goes through an
**adapter**, a module of pure functions that turns one provider's JSON into
this app's schema (rule 9). Moving from ESPN to BALLDONTLIE means writing a
new adapter and changing a config line. Adapters are tested against **recorded
real responses** in `test/fixtures/`. LESSONS P5 says a stub written from the
same reasoning as the code proves nothing. A `probe` script runs the adapter
against the live API on demand. **Do not scrape the official Fantasy Premier
League API** for player prices; it is the same terms problem as ESPN, and see
§5 for our own price model.

**News:** RSS headlines (ESPN, BBC Sport and others) showing only what the
feed provides: headline, short summary, source, time and a link out. No
article bodies and no rehosted images (ESPN's RSS terms, via research).

### Schema (new `sb_` tables in the shared Postgres)

| Table | Holds |
|---|---|
| `sb_competitions` | nfl, eng.1, usa.1, uefa.champions…; season |
| `sb_teams`, `sb_players` | names, abbr, colours, position, `provider_ids jsonb` |
| `sb_events` | one row per game **or** tournament: `kind`, `start_time timestamptz`, `status` (scheduled / live / final / postponed / cancelled), `week` or gameweek, scores, clock |
| `sb_event_competitors` | home/away, or a leaderboard row. Golf-ready without a redesign |
| `sb_player_event_stats` | box-score line per player per event (`stats jsonb`). Fantasy scoring reads this |
| `sb_player_season_stats`, `sb_standings` | refreshed nightly and after finals |
| `sb_news` | sport, title, summary, source, url, published_at |
| `sb_ingest_runs` | every job run: status, HTTP status, error, row count. Fly logs are ephemeral, so the history lives here |
| `sb_leagues`, `sb_league_members` | NFL fantasy and pick'em leagues; `invite_code` unique; members keyed on `users.id` |
| `sb_league_picks` | league pick'em, **locked server-side at `start_time`** |
| `sb_drafts`, `sb_draft_picks`, `sb_rosters`, `sb_lineups`, `sb_matchups` | NFL fantasy |
| `sb_player_prices` | soccer fantasy prices per gameweek (our own model) |
| `sb_squads`, `sb_squad_gameweeks` | soccer fantasy squads, transfers and captain per gameweek, locked at the deadline |
| `sb_handles` | anonymous leaderboard handles for free soccer players (§5) |

### Update cadence (`ingest` process)

| Job | When |
|---|---|
| Fixtures, next 14 days | every 6 h |
| **Live scores** | per competition, only while an event is inside `[start − 15 min, final]`, every 30–60 s |
| Box score on final | at final, then again at +2 h and +24 h (**stat corrections** change fantasy results) |
| Rosters, bios | daily |
| Season stats, standings | nightly, plus after finals |
| News | every 10–15 min |

- **One ingester at a time**, enforced with `pg_try_advisory_lock`.
- A **global request queue** with backoff, jitter and `Retry-After` handling.
  It saves results as it goes and stops after a long run of failures
  (LESSONS 8.7). This is especially polite toward ESPN during development.
- **Going final is one transaction.** When an event goes final, the same
  transaction grades pick'em and computes fantasy points, so no reader ever
  sees a final score with ungraded picks.
- **Fantasy periods finalise at a fixed time.** An NFL week finalises Tuesday
  10:00 ET; a soccer gameweek 24 h after its last match. Corrections before
  that are applied, and corrections after it are not. This gets written down
  so nobody "fixes" it.
- Times are UTC `timestamptz`, rendered in local time. Never use
  `new Date("YYYY-MM-DD")` (LESSONS 6.1).

### Read API (public, cacheable)

The routes are `GET /v1/sb/scores`, `/results`, `/events/:id`, `/news`,
`/players?q=`, `/players/:id`, `/teams/:id` and `/sports`. Every response
carries `as_of` and short `Cache-Control` / `ETag` headers. The existing
allow-list CORS already covers `sportsbook.thewizardofoza.com`.

### On the device

- `js/store.js` (`sportsbook:v1`) holds decisions, not content: favorites, solo
  picks and pick history, the solo soccer squad history, the sport filter and
  settings. Favorites are **id-keyed maps with timestamps and tombstones**, so
  cloud-save's union merge cannot resurrect an un-favorited team.
- **Service worker.** The shell is network-first (the house default). API GETs
  are network-first with a timeout, falling back to a separate
  `sportsbook-data` cache that `activate` must **not** delete. Authenticated
  responses are never cached. The UI always shows "as of 14:32".
- **No third-party images.** Team badges are generated from the abbreviation
  and team colours. That means zero third-party requests (rule 7), no
  image-licensing question, and no CSP traps (LESSONS 1.6/1.7).

## 5. The tabs in detail

**Settings leaves the tab bar.** The kit ships a Settings tab, but all five
slots are taken, so Settings becomes a gear in the `.topbar`. It holds
account, restore purchases, **Download backup (never gated)**, the privacy
statement and the build number.

**Favorites (default tab).** A star appears on every team, player, event and
sport. The feed shows each favourite team's live, next and last game, each
favourite player's latest stat line, starred events, and headlines for your
favourite sports. A new user sees an empty state that walks them through
picking sports, then teams.

**News.** Sport filter chips across the top (All · NFL · Premier League · MLS
· Champions League); the selection persists. Below them are a live/today
scores strip and a headline list. Tapping a headline opens the source site,
which the user chose to do.

**Scorecard.** A results archive by week or date, filtered by sport, reaching
back several weeks. Tapping a game opens a sheet with the box score.
**Pick'em** sits in the same tab:
- Upcoming games show pick buttons: home / away, plus **draw for soccer**.
  Each pick locks at kickoff and is graded automatically.
- History shows your record, accuracy by sport, current and best streak, and
  a week-by-week chart drawn as inline SVG with no library.
- **Solo pick'em is free, local and needs no account.** League pick'em is
  premium, and the server enforces the locks there.

**Fantasy — NFL (premium, leagues with friends).** Create a league (size,
scoring preset: standard / half-PPR / PPR, roster slots), then invite friends
(§6). The draft room is a live snake draft over SSE, with a pick timer and
autopick, plus an "auto-draft everyone" option. After the draft: roster,
weekly lineup (each player locks at their kickoff), matchup of the week,
standings and side-by-side team comparison. Free-agent add/drop comes first;
waivers come later.

**Fantasy — soccer (free, FPL-style, Premier League).** Pick a 15-player
squad (2 GK · 5 DEF · 5 MID · 3 FWD) under a 100.0 budget, with at most 3
players per club. Each gameweek you choose 11 starters and a captain (double
points) and get 1 free transfer. The squad locks 90 min before the gameweek's
first kickoff. Scoring covers minutes, goals by position, assists, clean
sheets, saves and cards.
- **Free players compete against themselves and a global leaderboard.** Their
  season history is local.
- **Joining the leaderboard doesn't need an account.** It is shown under an
  anonymous handle: a random device id plus a nickname. The **server** scores
  each squad from the squad it locked, so a score cannot be faked. Handles
  are rate-limited.
- **Premium adds** private mini-leagues with friends and history tracked on
  the account.
- **Design work flagged: player prices.** There is no licensed source for
  FPL-style prices, so we need our own model: a preseason price by position
  tier and last-season output, nudged each gameweek by form and ownership
  within ±0.3. This needs a written rule and a test table before build.

**Timing note.** The NFL is in week 4 and the Premier League around gameweek
6. A league created now works mid-season, but NFL fantasy's first *real*
season will likely be 2027 (drafts in August). Soccer fantasy can start from
the current gameweek.

**Players.** Search (server-side, prefix and fuzzy) and browsing by team. The
profile sheet shows bio, season stats, game log and fantasy points, with a
favorite button.

## 6. Friends, leagues and "nearby devices"

The web platform cannot make phones near each other find each other. Web
Bluetooth does not exist in iOS Safari, and Web NFC is Android Chrome only.
Native proximity would need an App Store wrapper, which is deferred (D5).
What works everywhere:

1. **Share sheet** (`navigator.share`) sends the invite link through the
   phone's native sheet, which **includes AirDrop on iOS and Quick Share on
   Android**. That is real proximity sharing at no extra cost.
2. **A QR code** on the host's screen, scanned by the friend's ordinary
   camera app. The encoder is a small vendored MIT file (e.g. Nayuki's) in
   `js/vendor/`. It works offline and adds no npm dependency.
3. **A six-character invite code** (no 0/O/1/I), the fallback that always
   works.

**iOS trap to design around.** A home-screen PWA on iOS has its own cookies,
storage and service worker, separate from Safari. Cookies are copied once, at
install, and never again (WebKit bug 181849; check on a device). A join link
opened from the camera or Messages lands in **Safari**, not the installed app,
signed out. So the join page always shows the code in big type with "Open
Sportsbook and enter ABC123". The code path must never be removed.

## 7. Money (D4)

One-time **$5 premium unlock** per the house rule: no subscription.
Everything is stored locally for everyone. Premium is the *personalized
account* that keeps track of it.

| Free, no account | Premium ($5 once, signed in) |
|---|---|
| All five tabs: scores, news, results, players | Favorites, preferences and pick history **saved to the account** and synced across devices (cloud save) |
| Favorites and preferences **on this device** | **NFL fantasy leagues**: create and join |
| Solo pick'em and its local history | **League pick'em** with friends |
| Soccer fantasy vs yourself and the global leaderboard | Private soccer mini-leagues |
| **Download backup**, always | |

Lines this plan holds, from rule 7, which will go in `CLAUDE.md` Invariants:

- Export is never gated.
- The app opens and works with no sign-in wall.
- Nothing free becomes paid later.

**Two things to know.** First, with leagues premium-only, **every friend in
an NFL league must pay $5**. That is your call, and it is defensible because
leagues carry real server cost. Second, the licensed data bill (≈ $40/mo) is
**recurring**, while $5 is paid once. At roughly $4.55 net per sale, that is
about 9 new sales a month to break even on data alone.

## 8. Build phases

Each phase ends with `npm test` green and an updated *Waiting on a human*
list.

| Phase | Delivers | Where | Blocked on a human? |
|---|---|---|---|
| **0 · Foundations** | Scaffold via `new-app.sh`; 5-tab shell, Favorites default, Settings gear, tokens, placeholder icon, build number in UI; sport registry; README / CLAUDE.md / BUGLOG | this repo | Name/colour (D8) can use placeholders |
| **1 · Data pipeline** | `sb_` migrations, ESPN adapter + recorded fixtures, `ingest` process and scheduler, `sb_ingest_runs`, `/v1/sb/*` read API, tests | GameHub | **GameHub push access**; deploy needs woz-accounts live |
| **2 · Read-only tabs** | News, Scorecard results, Players, Favorites + onboarding; offline "as of" | this repo | — (runs against a local server) |
| **3 · Pick'em (solo)** | Picks, draw option, locks, grading, history + chart | this repo | — |
| **4 · Soccer fantasy (free)** | Price model, squad builder, gameweeks, scoring, anonymous handles, global leaderboard | both | — |
| **5 · Premium + leagues** | Sign-in and $5 wired in; cloud save; leagues, invite code, share sheet, QR; league pick'em; soccer mini-leagues | both | woz-accounts deployed; Stripe price for `sportsbook` |
| **6 · NFL fantasy** | Settings, SSE draft room, rosters, lineups, scoring with corrections, matchups, standings, compare | both | Real multi-phone draft test |
| **7 · Launch** | **Switch to the licensed provider**, a11y pass, 390×844 / 375×667 checks, real-device checklist | both | Provider signup + key; DNS; device testing |

Soccer fantasy comes before NFL fantasy because it is free, needs no draft
room, and is in season. NFL fantasy is the biggest and riskiest feature.

## 9. Waiting on a human (known now)

1. **Add GameHub to the session with push access** before Phase 1. Server
   code goes in `setup/accounts/service`.
2. **Deploy woz-accounts for the first time** (setup/accounts/SETUP.md). It
   blocks every deployed data feature.
3. **DNS:** CNAME `sportsbook.thewizardofoza.com` → Cloudflare Pages.
4. **Stripe:** a Price for `sportsbook`, added to `APP_PRICES`.
5. **Licensed data provider** signup and key, as `fly secrets`, **before
   public launch**.
6. **Name, colour and icon** (D8).
7. **Real-device checks:** iOS join flow, install, a multi-phone draft.

## Decision log

| # | Decision | Taken 2026-09-28 |
|---|---|---|
| D1 | Data provider | ESPN unofficial for development; licensed (front-runner BALLDONTLIE) before launch |
| D2 | Sports at launch | NFL + soccer (EPL, MLS, UCL); multi-sport wiring from day one |
| D3 | Fantasy | NFL: season-long snake-draft leagues. Soccer: FPL-style budget game, Premier League |
| D4 | What the $5 buys | Personalized account (synced favorites, preferences, history) + all leagues. Soccer fantasy vs self/leaderboard is free |
| D5 | Native proximity | No; share sheet + QR + code |
| D6 | News | RSS headlines linking out; no article bodies |
| D7 | Server | Inside `woz-accounts`, with a separate `ingest` process group |
| D8 | Display name, colour, icon | **Open.** Placeholder "Sportsbook" until decided |
