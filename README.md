# Sportsbook

Scores, results, player stats, pick'em and fantasy for NFL and soccer, in one installable app for your phone. The full plan is in [`docs/PLAN.md`](./docs/PLAN.md).

<!-- This file is the app's mission and architecture — what it is and how it
     is put together. Where development actually stands goes in CLAUDE.md.
     Keep the split; a reader who wants one rarely wants the other. -->

## Core mission

<!-- One or two paragraphs. What problem this solves and for whom, and the
     one thing it refuses to do. The apps in this family all have a stance —
     no ads, no manipulation, no screen-time farming — and saying it here is
     what keeps it true later. -->

## How it works

<!-- The user's journey through the app, briefly. Not a feature list — the
     path someone actually takes. -->

## Structure

| Path | What it is |
|---|---|
| `index.html` | The shell: head tags, topbar, views, tabbar, sheets |
| `css/tokens.css` | The palette. Retheming happens here and nowhere else. |
| `css/base.css` | Reset, page geometry, motion, focus |
| `css/components.css` | Shared shell vocabulary |
| `css/app.css` | Sportsbook's own styles |
| `js/app.js` | App entry and wiring |
| `js/store.js` | Persistence: `sportsbook:v1` |
| `js/install.js` | Add-to-home-screen decision table |
| `js/ui.js` | View switching, sheets, toasts |
| `sw.js` | Service worker (network-first) |
| `icons/` | One SVG source, the whole generated icon set |
| `test/smoke.mjs` | Shell regression test |

## Running locally

```bash
npm install          # dev tools only — nothing ships to the browser
npm run serve        # then open http://localhost:8000/
```

The app itself has no build step. The files in this repo are the files the
browser runs. `npm install` only fetches the test runner and the icon
builder.

## Testing

```bash
npm test
```

Boots the app in a real browser and checks the shell still works: it loads,
tabs switch, the install sheet opens and closes, the service worker
activates, saved state survives corrupt and future-version data, and nothing
throws. Add app-specific cases at the marked point in `test/smoke.mjs`.

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
