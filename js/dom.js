/* ============================================================================
 * dom.js — the one way this app builds DOM, plus the shared widgets.
 *
 * Everything that came from the API (team names, player names, news
 * headlines from a third-party feed) goes in through textContent, never
 * innerHTML. A headline is somebody else's string; rendering it as markup is
 * an XSS hole with a news feed attached. `el()` makes the safe way the easy
 * way: children that are strings become text nodes.
 * ========================================================================= */

import { badgeInk, kickoffLabel, asOfLabel, fmtPts } from "./logic.js";

export function el(tag, props = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k === "style") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "text") node.textContent = v;
    else if (k in node && typeof v !== "string") node[k] = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of [].concat(kids)) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

export function mount(parent, ...kids) {
  parent.replaceChildren(...kids.flat().filter(Boolean));
}

/* A team badge: abbreviation on the team's own colour. No logo images — they
 * would be a third-party request for every free user (rule 7) and a
 * licensing question; the colour and three letters are what people scan for
 * anyway. */
export function badge(side, size = "") {
  const bg = side?.color ? `#${side.color}` : "var(--brown)";
  return el("span", {
    class: `team-badge ${size}`,
    style: { background: bg, color: badgeInk(side?.color) },
    "aria-hidden": "true",
  }, side?.abbr ?? "?");
}

export function statusText(event, now = Date.now()) {
  if (!event) return "";
  if (event.status === "live") return event.detail || "Live";
  if (event.status === "final") return event.detail || "Final";
  if (event.status === "postponed") return "Postponed";
  if (event.status === "cancelled") return "Cancelled";
  return kickoffLabel(event.start_time, now);
}

function sideRow(side, event) {
  const showScore = event.status === "live" || event.status === "final";
  const won = event.status === "final" && side.winner === true;
  return el("div", { class: `score-side${won ? " won" : ""}` }, [
    badge(side),
    el("span", { class: "score-team" }, [
      el("span", { class: "score-name" }, side.short || side.name || side.abbr),
      side.record ? el("span", { class: "score-record" }, side.record) : null,
    ]),
    el("span", { class: "score-pts" }, showScore && typeof side.score === "number" ? String(side.score) : ""),
  ]);
}

/** The standard game row: away on top, home below, status on the right. */
export function eventCard(event, { onOpen, extra } = {}) {
  const live = event.status === "live";
  return el("button", {
    class: `event-card${live ? " is-live" : ""}`,
    type: "button",
    dataset: { eventId: event.id },
    onclick: onOpen ? () => onOpen(event) : undefined,
    "aria-label": `${event.away?.name} at ${event.home?.name}, ${statusText(event)}`,
  }, [
    el("div", { class: "event-sides" }, [sideRow(event.away, event), sideRow(event.home, event)]),
    el("div", { class: "event-status" }, [
      live ? el("span", { class: "live-dot", "aria-hidden": "true" }) : null,
      statusText(event),
    ]),
    extra ?? null,
  ]);
}

export function asOf(data, stale) {
  const text = asOfLabel(data?.as_of, stale);
  return text ? el("p", { class: `as-of${stale ? " stale" : ""}` }, text) : null;
}

export function emptyState(title, sub, action) {
  return el("div", { class: "empty-state" }, [
    el("p", { class: "empty-title" }, title),
    sub ? el("p", { class: "empty-sub" }, sub) : null,
    action ?? null,
  ]);
}

export function loading(label = "Loading…") {
  return el("div", { class: "loading", role: "status" }, label);
}

/** The error state for a public read that failed with nothing cached. */
export function offlineState(retry) {
  return emptyState(
    "Can't reach Sportsbook",
    "Check your connection. Anything you've already opened will show here once it's been loaded once.",
    retry ? el("button", { class: "btn", type: "button", onclick: retry }, "Try again") : null,
  );
}

export function starButton({ on, label, onToggle }) {
  const b = el("button", {
    class: `star-btn${on ? " on" : ""}`,
    type: "button",
    "aria-pressed": on ? "true" : "false",
    "aria-label": `${on ? "Remove" : "Add"} ${label} ${on ? "from" : "to"} favorites`,
    onclick: (e) => {
      e.stopPropagation();
      const now = onToggle();
      b.classList.toggle("on", now);
      b.setAttribute("aria-pressed", now ? "true" : "false");
      b.setAttribute("aria-label", `${now ? "Remove" : "Add"} ${label} ${now ? "from" : "to"} favorites`);
    },
  }, "★");
  return b;
}

export function segmented(options, value, onChange, label) {
  const wrap = el("div", { class: "segmented", role: "group", "aria-label": label });
  for (const [v, text] of options) {
    wrap.append(el("button", {
      class: `seg${v === value ? " active" : ""}`,
      type: "button",
      "aria-pressed": v === value ? "true" : "false",
      onclick: () => onChange(v),
    }, text));
  }
  return wrap;
}

export function statTable(columns, rows) {
  return el("div", { class: "table-wrap" }, el("table", { class: "stat-table" }, [
    el("thead", {}, el("tr", {}, columns.map((c) => el("th", { scope: "col" }, c.label)))),
    el("tbody", {}, rows.map((r) => el("tr", {}, columns.map((c, i) =>
      el(i === 0 ? "th" : "td", i === 0 ? { scope: "row" } : {}, c.get(r)))))),
  ]));
}

export { fmtPts };
