# Sportsbook API — the contract between the app and the server

*Written 2026-09-28. The server half lives in the GameHub repo under
`setup/accounts/service/src/apps/sportsbook/`, mounted into `woz-accounts`
(docs/PLAN.md §2, decision D7). This file is the one both halves build
against; when they disagree, fix whichever one is wrong **and** this file.*

Base URL: `https://api.thewizardofoza.com` in production. The app reads an
override from `?api=http://localhost:8080` (persisted in `localStorage` key
`sportsbook:api`) so a local server can be used in development.

## Conventions

- **Every route is an exact `METHOD /path` match.** That is how
  `woz-accounts` routes (`routes["GET /v1/me"]`), so there are **no path
  parameters**; ids travel in the query string (`/v1/sb/event?id=…`).
- JSON in, JSON out. Errors are `{ "error": "message a person can read" }`
  with a 4xx/5xx status.
- **Public read routes** carry `Cache-Control: public, max-age=15` (live-ish)
  or `max-age=300` (slow data) and an `as_of` ISO timestamp in the body: the
  time the underlying data was last refreshed from the provider, not the time
  of the response. The app shows it ("as of 14:32").
- **Authenticated routes** use the shared `woz_session` cookie (fetch with
  `credentials: "include"`) and send `Cache-Control: no-store`. 401 = not
  signed in. 402 = signed in but the `sportsbook` unlock is missing
  (premium-only feature). The app must treat 402 as "show the unlock
  offer", never as an error toast.
- **Anonymous fantasy handles** send their token in the `X-SB-Handle` header.
  CORS `Access-Control-Allow-Headers` must therefore include `x-sb-handle`.
- Times are ISO-8601 UTC strings. Dates (`YYYY-MM-DD`) are strings and are
  never passed to `new Date()` on the client (LESSONS 6.1).
- `comp` is a competition id from the sport registry: `nfl` today;
  `eng.1`, `usa.1`, `uefa.champions` later. Unknown `comp` → 400.

## Shapes

```ts
Team  = { id, comp, abbr, name, short, color, alt_color, record }
        // color/alt_color: 6-hex without '#', from the provider; may be null
Side  = { team_id, abbr, name, short, color, alt_color, score, winner, record }
        // score: number|null (null before kickoff); winner: true|false|null
Event = { id, comp, season, week, start_time, status, period, clock, detail,
          venue, home: Side, away: Side }
        // status: "scheduled" | "live" | "final" | "postponed" | "cancelled"
        // detail: provider's short text — "Sun 1:00 PM", "Q3 4:12", "Final/OT"
Player = { id, comp, name, position, jersey, team_id, team_abbr }
Stats  = { [key: string]: number }   // see "NFL stat keys" below
NewsItem = { id, comp, title, summary, source, url, published_at }
```

### NFL stat keys

Normalised by the adapter from the provider's box score. A missing key means
zero.

`pass_cmp, pass_att, pass_yds, pass_td, pass_int, sacks,
 rush_att, rush_yds, rush_td,
 rec, rec_tgt, rec_yds, rec_td,
 fum, fum_lost, two_pt`

### Fantasy points (half-PPR), shared by server and app

`pass_yds × 0.04 + pass_td × 4 − pass_int × 2 + rush_yds × 0.1 +
 rush_td × 6 + rec × 0.5 + rec_yds × 0.1 + rec_td × 6 − fum_lost × 2 +
 two_pt × 2`, rounded to 0.01. One implementation, in the server's
`scoring.js`; the app only displays numbers the server computed.

## Public read routes

| Route | Returns |
|---|---|
| `GET /v1/sb/sports` | `{ as_of, demo, competitions: [{ id, sport, name, short, enabled, season, week, draws }] }` — `draws`: can a match end level (soccer yes, NFL no; drives the pick'em "draw" button). `demo: true` when the database was filled from the demo seed rather than a live provider; the app shows a banner |
| `GET /v1/sb/scoreboard?comp=&date=YYYY-MM-DD` | `{ as_of, date, events: Event[] }` — events whose start falls on that date in **America/New_York** (the NFL's calendar day). `date` omitted → today in ET, and if today has no events, the nearest date that does (so the News tab is never empty on a Tuesday) |
| `GET /v1/sb/results?comp=&weeks=4` | `{ as_of, weeks: [{ season, week, events: Event[] }] }` — **final** events only, newest week first, `weeks` capped at 10 |
| `GET /v1/sb/upcoming?comp=&days=10` | `{ as_of, events: Event[] }` — `scheduled` events starting within `days` (cap 21), soonest first |
| `GET /v1/sb/event?id=` | `{ as_of, event: Event, box: [{ team_id, players: [{ player_id, name, position, stats: Stats, fantasy_pts }] }] }` — `box` is `[]` before kickoff |
| `GET /v1/sb/teams?comp=` | `{ as_of, teams: Team[] }` sorted by name |
| `GET /v1/sb/team?id=` | `{ as_of, team: Team, last: Event|null, next: Event|null, roster: Player[] }` |
| `GET /v1/sb/players?comp=&q=&team=&limit=30` | `{ players: Player[] }` — `q` is a case-insensitive prefix match on any word of the name (≥ 2 chars); `team` filters by team id; limit capped at 50 |
| `GET /v1/sb/player?id=` | `{ as_of, player: Player, season: { season, games, totals: Stats, fantasy_pts, fantasy_ppg }, gamelog: [{ event_id, start_time, week, opponent_abbr, home, result, stats: Stats, fantasy_pts }] }` — `result` e.g. `"W 27-20"`, newest first |
| `GET /v1/sb/news?comp=&limit=30` | `{ as_of, items: NewsItem[] }` — `comp=all` or omitted → every enabled competition, newest first; `limit` cap 60 |

## Squad game (free fantasy, budget style)

NFL rules for launch (docs/PLAN.md §5, adapted from the soccer design because
NFL is the starting sport):

- A **lineup per week**: `QB ×1, RB ×2, WR ×3, TE ×1, FLEX ×1` (FLEX = RB, WR
  or TE). 8 players.
- **Budget 100.0.** Prices are the server's (`pricing.js`), per player per week.
- **Max 3 players from one NFL team.**
- A **captain** scores double.
- The lineup **locks at the week's deadline**: the kickoff of the week's first
  game. After the deadline, `POST` is refused (409) and everyone's lineups
  become visible on the leaderboard.
- Points = sum of each player's half-PPR points in that week's games,
  captain ×2. Recomputed whenever a box score is refreshed, frozen when the
  week finalises (Tuesday 10:00 ET after the last game).

| Route | Returns |
|---|---|
| `POST /v1/sb/handles` `{ nickname }` | `{ handle: { id, nickname }, token }` — anonymous identity, no account. Nickname 2–20 chars, letters/digits/space/`_-.`, trimmed; profanity is not filtered (flag, don't build). Rate limit 5/hour/IP. **The token is shown once**; the app stores it in its own store and it is included in Download backup |
| `GET /v1/sb/handles/me` (X-SB-Handle) | `{ handle: { id, nickname, user_id } }` or 401 |
| `POST /v1/sb/handles/claim` (cookie + X-SB-Handle) | Links the handle to the signed-in user so mini-leagues can find its entries. Premium not required to claim. `{ ok: true }` |
| `GET /v1/sb/squad/pool?comp=&week=` | `{ as_of, season, week, deadline, locked, budget: 100, slots: { QB:1, RB:2, WR:3, TE:1, FLEX:1 }, max_per_team: 3, players: [{ id, name, position, team_id, team_abbr, price, opponent_abbr, home, start_time }] }` — `week` omitted → the current open week (first week whose deadline is in the future), else the latest |
| `GET /v1/sb/squad/entry?comp=&week=` (X-SB-Handle) | `{ entry: { week, lineup: { QB:[id], RB:[id,id], WR:[id,id,id], TE:[id], FLEX:[id] }, captain, cost, points, breakdown: [{ player_id, pts, captain }] } | null }` |
| `POST /v1/sb/squad/entry` (X-SB-Handle) `{ comp, week, lineup, captain }` | Validates slots, positions, budget, team cap, captain ∈ lineup, not locked. `{ entry }` or 400 with a message naming the rule broken, or 409 when locked |
| `GET /v1/sb/squad/leaderboard?comp=&week=` | `{ as_of, week, rows: [{ rank, handle_id, nickname, points }] }` — `week` omitted → season totals. Top 100 |

## Premium: leagues (need sign-in **and** the `sportsbook` unlock → else 401/402)

A league is either `pickem` (predict winners of every game in the comp) or
`squad` (a private leaderboard over members' squad-game entries).

| Route | Returns |
|---|---|
| `GET /v1/sb/leagues` | `{ leagues: [{ id, name, kind, comp, invite_code, role, members }] }` — the signed-in user's leagues |
| `POST /v1/sb/leagues` `{ name, kind, comp }` | `{ league }`, creator is `owner`. Name 2–40 chars. Max 20 leagues owned per user |
| `POST /v1/sb/leagues/join` `{ code }` | `{ league }`. Code is 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I), case-insensitive, whitespace ignored. 404 unknown code. Max 50 members. Rate limit 20/hour/user |
| `POST /v1/sb/leagues/leave` `{ id }` | `{ ok: true }` — the owner leaving with others present passes ownership to the longest-standing member; the last member leaving deletes the league |
| `GET /v1/sb/league?id=` | Members only. `{ league, members: [{ user_id, name, role }], standings: [{ user_id, name, points, correct, graded }] }` — pickem: `correct`/`graded` counts, `points` = correct; squad: `points` = season total of the member's claimed handle's entries |
| `GET /v1/sb/league/picks?id=&week=` | Members only. `{ week, events: Event[], mine: { [event_id]: "home"|"away"|"draw" }, others: [{ user_id, name, picks: {…} }] }` — **others' picks for an event are included only once that event has started** |
| `POST /v1/sb/league/picks` `{ id, event_id, pick }` | `{ ok: true }` or 409 if the event has started (**server clock, `start_time`**). `pick: "draw"` only when the comp allows draws |

## Settled in implementation (2026-09-28)

Where the server had to decide something this file left open, or changed
it for a reason. The app matches all of these.

1. **Prices run ≈ 4.0 – 18.0.** A top QB ≈ 17, top RB/WR ≈ 15.5–16, top TE
   ≈ 12, bench players at the 4.0–4.5 floor. At the first draft of the scale
   eight stars cost ≈ 86, so the 100.0 budget never bound; the ratios were
   kept and the scale raised. Points per game divide by the TEAM's games
   played, so a benched backup prices at the floor rather than at a
   position default. Rule and table: `pricing.js` and its tests.
2. **Leaderboard rows gain `lineup` and `captain` once the week has locked**
   (absent before the deadline, so nobody can copy a rival's squad).
3. **`breakdown[].pts` already includes the captain's doubling.** Sum it and
   you get `points`.
4. **Player season totals count final games only.** The game log also lists
   a live game, with `result` like `"Live 10-7"`.
5. **A league you are not in is a 404, exactly like one that does not exist**
   — a private league's existence is not confirmed to outsiders.
   **Leaving needs only sign-in, not Premium**: a refunded user must never be
   trapped in a league.
6. **Member names** are the account's display name, else a claimed squad
   nickname, else "Member". Emails are never shown to other members.
7. **Squad-league standings** carry `correct: null, graded: null`. A member
   with several claimed handles counts their best entry each week.
8. **Omitted `week`:** `squad/pool` and `squad/entry` use the open week (the
   first whose deadline is still ahead); `league/picks` uses the current week.

## What the server stores (for reference)

`sb_competitions, sb_teams, sb_players, sb_events, sb_player_event_stats,
sb_news, sb_ingest_runs, sb_meta, sb_handles, sb_squad_entries,
sb_player_prices, sb_leagues, sb_league_members, sb_league_picks` — all
prefixed `sb_` so nothing collides with the accounts tables.
