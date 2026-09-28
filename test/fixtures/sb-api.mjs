/*
 * A stub of the Sportsbook API for the browser smoke test.
 *
 * WHAT THIS IS NOT: evidence that the real server behaves this way. It is
 * written from docs/API.md — the same understanding the app was written
 * from — so it can only catch the app drifting from the contract, never the
 * server drifting from it (setup/LESSONS.md P5, "a stub cannot falsify the
 * belief that produced it"). The server's own integration test, in the
 * GameHub repo, is what exercises the real routes against a real Postgres.
 *
 * Teams are real NFL teams (public facts); every PLAYER NAME IS INVENTED.
 * Times are anchored to `now` so "upcoming" is always upcoming.
 */

export function createSbStub({ now = Date.now(), premium = false, demo = false } = {}) {
  const iso = (ms) => new Date(ms).toISOString();
  const H = 3600e3, D = 24 * H;

  const teams = [
    { id: "12", comp: "nfl", abbr: "KC", name: "Kansas City Chiefs", short: "Chiefs", color: "e31837", alt_color: "ffb612", record: "3-0" },
    { id: "2", comp: "nfl", abbr: "BUF", name: "Buffalo Bills", short: "Bills", color: "00338d", alt_color: "c60c30", record: "2-1" },
    { id: "21", comp: "nfl", abbr: "PHI", name: "Philadelphia Eagles", short: "Eagles", color: "004c54", alt_color: "a5acaf", record: "1-2" },
    { id: "6", comp: "nfl", abbr: "DAL", name: "Dallas Cowboys", short: "Cowboys", color: "003594", alt_color: "869397", record: "2-1" },
  ];
  const T = Object.fromEntries(teams.map((t) => [t.abbr, t]));
  const side = (abbr, score = null, winner = null) => ({
    team_id: T[abbr].id, abbr, name: T[abbr].name, short: T[abbr].short,
    color: T[abbr].color, alt_color: T[abbr].alt_color, score, winner, record: T[abbr].record,
  });
  const event = (id, week, start, status, away, home, detail) => ({
    id, comp: "nfl", season: 2026, week, start_time: iso(start), status, period: null, clock: null,
    detail, venue: "Stub Stadium", away, home,
  });

  const events = {
    e301: event("e301", 3, now - 8 * D, "final", side("BUF", 24, false), side("KC", 27, true), "Final"),
    e302: event("e302", 3, now - 8 * D + 3 * H, "final", side("DAL", 20, true), side("PHI", 17, false), "Final"),
    e403: event("e403", 4, now - 1 * H, "live", side("DAL", 10), side("KC", 14), "Q3 4:12"),
    e401: event("e401", 4, now + 2 * D, "scheduled", side("KC"), side("PHI"), "Sun 1:00 PM"),
    e402: event("e402", 4, now + 3 * D, "scheduled", side("BUF"), side("DAL"), "Mon 8:15 PM"),
  };

  const P = (id, name, position, abbr, price, extra = {}) => ({
    id, comp: "nfl", name, position, jersey: String(10 + Number(id.slice(1))), team_id: T[abbr].id, team_abbr: abbr, price, ...extra,
  });
  const players = [
    P("p1", "Jalen Stone", "QB", "KC", 11.5), P("p2", "Marcus Vale", "QB", "BUF", 10.8),
    P("p3", "Dorian Pike", "RB", "KC", 9.4), P("p4", "Theo Brandt", "RB", "PHI", 8.1),
    P("p5", "Quinn Mercer", "RB", "DAL", 6.2), P("p6", "Rico Hale", "WR", "BUF", 10.2),
    P("p7", "Silas Dunmore", "WR", "PHI", 8.8), P("p8", "Emmett Crane", "WR", "DAL", 7.4),
    P("p9", "Nico Farrow", "WR", "KC", 6.0), P("p10", "Grady Holt", "TE", "PHI", 6.6),
    P("p11", "Wes Arden", "TE", "BUF", 4.5), P("p12", "Cal Brook", "WR", "DAL", 4.2),
  ];

  const news = [
    { id: "n1", comp: "nfl", title: "Stub headline: Chiefs stay perfect", summary: "A summary line.", source: "Stub News", url: "https://example.com/1", published_at: iso(now - 2 * H) },
    // Proves headlines render as TEXT: if this ever becomes an element, the
    // smoke test's XSS check fails.
    { id: "n2", comp: "nfl", title: "<img src=x onerror=\"window.__xss=1\"> Bills injury report", summary: "", source: "Stub News", url: "https://example.com/2", published_at: iso(now - 5 * H) },
  ];

  let handle = null;
  let entry = null;
  const leagues = [];
  const asOf = iso(now - 60e3);
  const pub = (json) => ({ status: 200, json: { as_of: asOf, ...json } });

  function handler(url, method, body, headers = {}) {
    const u = new URL(url);
    const q = (k) => u.searchParams.get(k);
    const route = `${method} ${u.pathname}`;
    const hasHandle = handle && headers["x-sb-handle"] === handle.token;

    switch (route) {
      case "GET /v1/me":
        return { status: 200, json: premium
          ? { user: { id: "u1", email: "fan@example.com", name: "Fan", has_password: false }, entitlements: { sportsbook: true } }
          : { user: null, entitlements: {} } };
      // Cloud save (the shared service's /v1/data), just enough for a
      // Premium session to sync without errors: nothing stored remotely,
      // every push accepted.
      case "GET /v1/data":
        return { status: 200, json: { cursor: 0, documents: [], more: false } };
      case "POST /v1/data":
        return { status: 200, json: { cursor: 1, results: (body?.documents ?? []).map((d) => ({ key: d.key, ok: true, rev: (d.base_rev ?? 0) + 1 })) } };
      case "GET /v1/sb/sports":
        return pub({ demo, competitions: [
          { id: "nfl", sport: "football", name: "NFL", short: "NFL", enabled: true, season: 2026, week: 4, draws: false },
          { id: "eng.1", sport: "soccer", name: "Premier League", short: "EPL", enabled: false, season: 2026, week: null, draws: true },
        ] });
      case "GET /v1/sb/scoreboard":
        return pub({ date: iso(now).slice(0, 10), events: [events.e403, events.e401] });
      case "GET /v1/sb/results":
        return pub({ weeks: [{ season: 2026, week: 3, events: [events.e301, events.e302] }] });
      case "GET /v1/sb/upcoming":
        return pub({ events: [events.e401, events.e402] });
      case "GET /v1/sb/event": {
        const e = events[q("id")];
        if (!e) return { status: 404, json: { error: "not found" } };
        const box = e.status === "final" ? [{ team_id: e.home.team_id, players: [
          { player_id: "p1", name: "Jalen Stone", position: "QB", stats: { pass_cmp: 24, pass_att: 33, pass_yds: 288, pass_td: 3, pass_int: 1 }, fantasy_pts: 21.52 },
        ] }] : [];
        return pub({ event: e, box });
      }
      case "GET /v1/sb/teams":
        return pub({ teams });
      case "GET /v1/sb/team": {
        const t = teams.find((x) => x.id === q("id"));
        if (!t) return { status: 404, json: { error: "not found" } };
        return pub({ team: t, last: events.e301, next: events.e401,
          roster: players.filter((p) => p.team_id === t.id).map(({ price, ...p }) => p) });
      }
      case "GET /v1/sb/players": {
        const s = (q("q") ?? "").toLowerCase();
        const list = players.filter((p) => (!s || p.name.toLowerCase().split(" ").some((w) => w.startsWith(s)))
          && (!q("team") || p.team_id === q("team")));
        return { status: 200, json: { players: list.map(({ price, ...p }) => p) } };
      }
      case "GET /v1/sb/player": {
        const p = players.find((x) => x.id === q("id"));
        if (!p) return { status: 404, json: { error: "not found" } };
        const { price, ...player } = p;
        return pub({ player, season: { season: 2026, games: 3, totals: { pass_yds: 850, pass_td: 7, pass_int: 2, rush_yds: 40 }, fantasy_pts: 60.1, fantasy_ppg: 20.03 },
          gamelog: [{ event_id: "e301", start_time: events.e301.start_time, week: 3, opponent_abbr: "BUF", home: true, result: "W 27-24", stats: { pass_yds: 288, pass_td: 3 }, fantasy_pts: 21.52 }] });
      }
      case "GET /v1/sb/news":
        return pub({ items: news });
      case "GET /v1/sb/squad/pool":
        return pub({ season: 2026, week: 4, deadline: iso(now + 2 * D), locked: false, budget: 100,
          slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1 }, max_per_team: 3,
          players: players.map((p) => ({ id: p.id, name: p.name, position: p.position, team_id: p.team_id, team_abbr: p.team_abbr, price: p.price, opponent_abbr: "OPP", home: true, start_time: iso(now + 2 * D) })) });
      case "POST /v1/sb/handles":
        handle = { id: "h1", nickname: body?.nickname ?? "Fan", token: "tok-h1" };
        return { status: 200, json: { handle: { id: handle.id, nickname: handle.nickname }, token: handle.token } };
      case "GET /v1/sb/squad/entry":
        return hasHandle ? { status: 200, json: { entry } } : { status: 401, json: { error: "unknown handle" } };
      case "POST /v1/sb/squad/entry":
        if (!hasHandle) return { status: 401, json: { error: "unknown handle" } };
        entry = { week: body.week, lineup: body.lineup, captain: body.captain, cost: 0, points: 0, breakdown: [] };
        return { status: 200, json: { entry } };
      case "POST /v1/sb/handles/claim":
        return { status: 200, json: { ok: true } };
      case "GET /v1/sb/squad/leaderboard":
        return pub({ week: q("week") ? Number(q("week")) : null, rows: [{ rank: 1, handle_id: "hx", nickname: "Top Dog", points: 142.5 }] });
    }

    if (u.pathname.startsWith("/v1/sb/league")) {
      if (!premium) return { status: 402, json: { error: "This needs Sportsbook Premium." } };
      if (route === "GET /v1/sb/leagues") return { status: 200, json: { leagues } };
      if (route === "POST /v1/sb/leagues") {
        const league = { id: `l${leagues.length + 1}`, name: body.name, kind: body.kind, comp: body.comp, invite_code: "K7Q2MX", role: "owner", members: 1 };
        leagues.push(league);
        return { status: 200, json: { league } };
      }
      if (route === "GET /v1/sb/league") {
        const league = leagues.find((l) => l.id === q("id"));
        if (!league) return { status: 404, json: { error: "not found" } };
        return { status: 200, json: { league, members: [{ user_id: "u1", name: "Fan", role: "owner" }],
          standings: [{ user_id: "u1", name: "Fan", points: 0, correct: 0, graded: 0 }] } };
      }
      if (route === "GET /v1/sb/league/picks") return { status: 200, json: { week: 4, events: [events.e401], mine: {}, others: [] } };
      if (route === "POST /v1/sb/league/picks") return { status: 200, json: { ok: true } };
    }
    return { status: 404, json: { error: `stub has no ${route}` } };
  }

  return { handler, set premium(v) { premium = v; }, set demo(v) { demo = v; } };
}
