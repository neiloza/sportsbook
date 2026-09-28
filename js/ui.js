/* ============================================================================
 * ui.js — the shell behaviours every app in the set repeats.
 *
 * View switching, bottom sheets, toasts. Nothing app-specific belongs here.
 * ========================================================================= */

/* --- views ---------------------------------------------------------------
 * Exactly one .view carries .active. Tabs declare their target with
 * `data-view="foo"`, which resolves to `#view-foo`. Keeping the mapping in
 * the markup means adding a tab is one button and one section, with no
 * matching switch statement to forget to update. */

export function showView(name) {
  document.querySelectorAll(".view").forEach((el) => {
    el.classList.toggle("active", el.id === `view-${name}`);
  });
  document.querySelectorAll(".tab").forEach((el) => {
    const on = el.dataset.view === name;
    el.classList.toggle("active", on);
    // aria-current, not aria-selected: these are navigation, not a tablist.
    if (on) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  // A view change is a new screen — start it at the top.
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  document.dispatchEvent(new CustomEvent("view:change", { detail: { name } }));
}

export function initTabs(defaultView) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => showView(tab.dataset.view));
  });
  if (defaultView) showView(defaultView);
}

/* --- sheets --------------------------------------------------------------
 * A sheet is an .overlay containing a .overlay-backdrop and a .sheet. It
 * closes on: the close button, any [data-sheet-close] (including the
 * backdrop), and Escape. All three, always — a modal you can only leave one
 * way is a trap on some device you did not test. */

export function openSheet(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.hidden = false;
  overlay.querySelector("[data-sheet-close]")?.focus({ preventScroll: true });
  document.body.style.overflow = "hidden";
}

export function closeSheet(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.hidden = true;
  document.body.style.overflow = "";
}

export function initSheets() {
  document.querySelectorAll(".overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target.closest("[data-sheet-close]")) closeSheet(overlay.id);
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".overlay:not([hidden])").forEach((o) => closeSheet(o.id));
  });
}

/* --- toast ---------------------------------------------------------------
 * One element, reused. aria-live="polite" so it is announced without
 * interrupting; role="status" so it is announced at all. */

let toastTimer = null;

export function toast(message, ms = 2600) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}
