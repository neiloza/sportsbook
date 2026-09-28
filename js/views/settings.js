/* ============================================================================
 * Settings — reached from the gear, not a tab. Account, Premium, backup,
 * privacy, and the build number.
 *
 * Download backup is here for EVERYONE and is never behind the unlock
 * (rule 7): a paywall between a person and their own data is the one line
 * that never moves.
 * ========================================================================= */

import { el, mount } from "../dom.js";
import { exportState, importState } from "../store.js";
import { API_BASE } from "../api.js";

export function createSettingsView(ctx) {
  const root = document.getElementById("view-settings");

  function render() {
    const signedIn = ctx.account.signedIn();
    const user = ctx.account.user();
    const paid = ctx.isPremium();
    const handle = ctx.state.squad.handle;

    mount(root,
      el("h2", { class: "view-title" }, "Settings"),

      el("section", { class: "panel" }, [
        el("h3", { class: "panel-head" }, "Account"),
        el("p", { class: "panel-sub" }, signedIn
          ? `Signed in${user?.email ? ` as ${user.email}` : ""}.`
          : "Not signed in. Everything works without an account; an account carries Premium between devices."),
        el("div", { class: "btn-row" }, el("button", { class: "btn", type: "button", onclick: () => ctx.openAccount() },
          signedIn ? "Manage account" : "Sign in")),
      ]),

      el("section", { class: "panel" }, [
        el("h3", { class: "panel-head" }, paid ? "Premium ✓" : "Premium — $5, once"),
        el("p", { class: "panel-sub" }, paid
          ? "Your favorites, preferences and pick history are saved to your account and synced across devices. Leagues are unlocked."
          : "Saves your favorites, preferences and pick history to your account, on every device, and unlocks leagues with friends. One payment, no subscription."),
        el("div", { class: "btn-row" }, [
          paid ? null : el("button", { class: "btn btn-primary", type: "button", onclick: () => ctx.requirePremium() }, "Get Premium"),
          signedIn ? el("button", {
            class: "btn", type: "button",
            onclick: async () => { await ctx.account.refresh(); ctx.toast(ctx.isPremium() ? "Premium restored." : "No purchase found on this account."); render(); },
          }, "Restore purchases") : null,
        ]),
      ]),

      el("section", { class: "panel" }, [
        el("h3", { class: "panel-head" }, "Your data"),
        el("p", { class: "panel-sub" },
          "Favorites, picks and your squad name are stored on this phone. A backup file is the only thing that survives losing the phone without Premium — and it's free."),
        el("div", { class: "btn-row" }, [
          el("button", { class: "btn", type: "button", onclick: download }, "Download backup"),
          el("label", { class: "btn" }, ["Restore backup", el("input", {
            type: "file", accept: "application/json,.json", class: "sr-only",
            onchange: (e) => restore(e.target.files?.[0]),
          })]),
        ]),
        handle ? el("p", { class: "fine" }, `Squad name: ${handle.nickname}`) : null,
      ]),

      el("section", { class: "panel" }, [
        el("h3", { class: "panel-head" }, "Privacy"),
        el("p", { class: "panel-sub" },
          "No ads, no analytics, no tracking. If you sign in with Premium, your favorites, preferences and pick history are copied to your account so they can be given back to you on another device — and for nothing else. Deleting your account deletes them."),
        el("p", { class: "fine" }, "Pick'em and fantasy are for points only. Sportsbook never takes bets or links to betting sites."),
      ]),

      el("section", { class: "panel" }, [
        el("h3", { class: "panel-head" }, "About"),
        el("p", { class: "panel-sub" }, ["Build ", el("span", { id: "build-number" }, "—")]),
        el("p", { class: "fine" }, `Data: ${ctx.demo ? "demo data (not real games)" : "live scores"} · ${API_BASE.replace(/^https?:\/\//, "")}`),
      ]),
    );
    ctx.showBuildNumber();
  }

  function download() {
    const blob = new Blob([exportState(ctx.state)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `sportsbook-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function restore(file) {
    if (!file) return;
    const next = importState(await file.text());
    if (!next) return ctx.toast("That file isn't a Sportsbook backup.");
    if (!confirm("Replace this phone's favorites and picks with the backup?")) return;
    ctx.replaceState(next);
    ctx.toast("Backup restored.");
    render();
  }

  return { render };
}
