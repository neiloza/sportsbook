/*
 * account-ui.js — the sign-in sheet, drop-in.
 *
 * Pairs with `account.js`. That file talks to the service; this one is the
 * only thing that knows what a sign-in looks like. Every app on the domain
 * gets the same sheet, so somebody who has signed in to one recognises the
 * next — which matters more than usual here, because the account really IS
 * shared.
 *
 * It builds its own markup, so the only thing an app needs in `index.html` is
 * one empty overlay:
 *
 *   <div class="overlay" id="account-sheet" hidden>
 *     <div class="overlay-backdrop" data-sheet-close></div>
 *     <div class="sheet">
 *       <div class="sheet-head">
 *         <h2 class="sheet-title" id="account-title">Account</h2>
 *         <button class="icon-btn" data-sheet-close aria-label="Close">✕</button>
 *       </div>
 *       <div class="sheet-body" id="account-body"></div>
 *     </div>
 *   </div>
 *
 * Elements are built with createElement and never innerHTML — house
 * convention, and it matters more here than elsewhere because some of this
 * text comes back from the server.
 */

import { openSheet, closeSheet, toast } from "./ui.js";

/*
 * ONE SENTENCE, USED IN THREE PLACES, AND IT MUST NOT VARY.
 *
 * The reset form answers identically whether or not an address has an account,
 * because "no account with that email" is an account-enumeration oracle — it
 * lets anybody test which addresses are registered. The service already
 * guarantees the same response either way; this constant is what stops the UI
 * from leaking the difference that the service was careful not to.
 */
const RESET_SENT =
  "If that address has an account, a link is on its way. It works once and " +
  "expires in an hour. Check your spam folder.";

export function initAccountUI(account, { sheetId = "account-sheet", bodyId = "account-body",
                                         titleId = "account-title", appName = "this app",
                                         sync = null } = {}) {
  const body = document.getElementById(bodyId);
  const title = document.getElementById(titleId);
  if (!body) return { open() {}, close() {} };

  let mode = "signin";          // signin | signup | forgot | reset | account
  let resetToken = null;
  let busy = false;

  const el = (tag, props = {}, kids = []) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const kid of [].concat(kids)) if (kid) node.append(kid);
    return node;
  };

  function setBusy(on) {
    busy = on;
    for (const b of body.querySelectorAll("button")) b.disabled = on;
  }

  function fail(err) {
    // The service's messages are written to be read by a person, so they are
    // shown as-is. A message it did NOT write (a network failure) gets a
    // sentence that says what to do instead of what went wrong.
    const note = body.querySelector(".account-error");
    const text = err?.message && err.status
      ? err.message
      : "Could not reach the server. Check your connection and try again.";
    if (note) {
      note.textContent = text;
      note.hidden = false;
    } else {
      toast(text);
    }
  }

  function field(label, type, name, autocomplete) {
    const input = el("input", { type, name, autocomplete, required: true, className: "input" });
    return { input, node: el("label", { className: "account-field" }, [
      el("span", { className: "account-label", textContent: label }),
      input,
    ])};
  }

  function render() {
    body.replaceChildren();
    const error = el("p", { className: "account-error", hidden: true, role: "alert" });

    /* --- signed in ------------------------------------------------------- */
    if (mode === "account") {
      const u = account.user();
      title.textContent = "Your account";
      const paid = account.isPaid();

      body.append(
        el("p", { className: "account-who", textContent: u.email || u.name || "Signed in" }),
        // Says WHICH method is signed in. This is the single best mitigation
        // for "I bought this and it says I have not" — somebody who bought
        // with Google and later signed up with a password needs to be able to
        // SEE that they are in the wrong account.
        el("p", {
          className: "account-sub",
          textContent: u.has_password
            ? "Signed in with an email and password."
            : "Signed in with Google.",
        }),
        el("p", {
          className: paid ? "account-badge is-paid" : "account-badge",
          textContent: paid ? `${appName} is unlocked. Thank you.` : `${appName} — free version`,
        })
      );

      if (!paid) {
        body.append(el("button", {
          className: "btn btn-primary btn-block",
          textContent: sync ? "Unlock — $5, once" : "Unlock everything — $5, once",
          onclick: async () => {
            setBusy(true);
            try { await account.startCheckout(); } catch (e) { setBusy(false); fail(e); }
          },
        }));
      }

      if (sync && !sync.enabled()) {
        /*
         * A free user, signed in. Tell them what the unlock adds AND that
         * they are not currently losing anything — because the obvious fear,
         * on seeing "cloud save" behind a paywall, is that their data is at
         * risk until they pay. It is not: it is on the device, and export is
         * never paywalled (APP_DESIGN_RULES rule 7).
         */
        body.append(el("p", {
          className: "account-note",
          textContent:
            "Cloud save is part of the unlock: your data would sync to this " +
            "account and appear on your other devices. Until then it is safe " +
            "on this device, and Download backup in Settings always works.",
        }));
      }

      if (sync && sync.enabled()) {
        // Filled in asynchronously: a Settings sheet must open instantly, and
        // this is the least important thing on it.
        sync.usage().then((u) => {
          const line = document.getElementById("account-usage");
          if (!line || !u) return;
          line.textContent =
            `Cloud save: ${Math.max(1, Math.round(u.bytes / 1024))}KB of ` +
            `${Math.round(u.limit / 1024 / 1024)}MB used.`;
        });

        body.append(el("button", {
          className: "btn btn-block",
          textContent: "Sync now",
          // The "my other phone is missing things" button. Pulls everything
          // and re-merges rather than trusting the stored cursor, because a
          // cursor that is wrong is invisible and this is the way out.
          onclick: async () => {
            setBusy(true);
            const result = await sync.full();
            setBusy(false);
            toast(result?.error ? "Could not reach the server." : "Synced.");
            render();
          },
        }));
      }

      body.append(
        el("button", {
          className: "btn btn-block",
          textContent: "Restore purchases",
          // Exists because the background refresh will occasionally not have
          // run, and the user has no way to know that.
          onclick: async () => {
            setBusy(true);
            await account.refresh();
            setBusy(false);
            render();
            toast(account.isPaid() ? "Restored." : "Nothing to restore on this account.");
          },
        }),
        // What signing in actually does, in the words a user needs. This
        // sentence was the opposite before cloud save existed; if the app has
        // no sync wired up it says the old, still-true thing instead.
        el("p", {
          className: "account-note",
          textContent: sync?.enabled()
            ? "Your data is saved to this account, so it survives a lost phone " +
              "and appears on your other devices. Download backup in Settings " +
              "is still the copy only you hold."
            : "Signing in carries your purchase between devices. Your data " +
              "stays on this device — use Download backup in Settings for a " +
              "copy you hold.",
        }),
        el("p", { className: "account-note", id: "account-usage" }),
        el("button", {
          className: "btn btn-ghost btn-block",
          textContent: "Sign out",
          onclick: async () => {
            setBusy(true);
            await account.signOut();
            setBusy(false);
            mode = "signin";
            render();
          },
        }),
        error
      );
      return;
    }

    /* --- set a new password, arrived from a reset link -------------------- */
    if (mode === "reset") {
      title.textContent = "Choose a new password";
      const pw = field("New password", "password", "password", "new-password");
      const form = el("form", { className: "account-form" }, [
        pw.node,
        el("p", { className: "account-note", textContent: "At least 8 characters." }),
        el("button", { className: "btn btn-primary btn-block", type: "submit",
                       textContent: "Set password and sign in" }),
        error,
      ]);
      form.onsubmit = async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true); error.hidden = true;
        try {
          await account.resetPassword(resetToken, pw.input.value);
          resetToken = null;
          mode = "account";
          render();
          // Said out loud because it is surprising, and because somebody who
          // reset BECAUSE they feared an intruder needs to know it worked.
          toast("Password changed. Other devices have been signed out.");
        } catch (err) {
          setBusy(false);
          fail(err);
        }
      };
      body.append(form);
      return;
    }

    /* --- forgot ----------------------------------------------------------- */
    if (mode === "forgot") {
      title.textContent = "Reset your password";
      const email = field("Email", "email", "email", "email");
      const form = el("form", { className: "account-form" }, [
        email.node,
        el("button", { className: "btn btn-primary btn-block", type: "submit",
                       textContent: "Send me a link" }),
        error,
      ]);
      form.onsubmit = async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true); error.hidden = true;
        try {
          await account.sendPasswordReset(email.input.value);
          body.replaceChildren(
            el("p", { className: "account-sent", textContent: "📬 Check your inbox" }),
            // The identical answer, whatever the address. See RESET_SENT.
            el("p", { className: "account-note", textContent: RESET_SENT }),
            el("button", { className: "btn btn-ghost btn-block", textContent: "Back to sign in",
                           onclick: () => { mode = "signin"; render(); } })
          );
        } catch (err) {
          setBusy(false);
          fail(err);
        }
      };
      body.append(form, el("button", {
        className: "btn btn-ghost btn-block", textContent: "Back",
        onclick: () => { mode = "signin"; render(); },
      }));
      return;
    }

    /* --- sign in / sign up ------------------------------------------------ */
    const isSignUp = mode === "signup";
    title.textContent = isSignUp ? "Create an account" : "Sign in";

    body.append(
      el("button", {
        className: "btn btn-block account-google",
        textContent: "Continue with Google",
        onclick: () => account.signInWithGoogle(),
      }),
      el("p", {
        className: "account-note",
        // Worth saying: it is the whole point, and it is not obvious.
        textContent: "One account covers every app on thewizardofoza.com.",
      }),
      el("div", { className: "account-or", textContent: "or" })
    );

    const email = field("Email", "email", "email", "email");
    const pw = field("Password", "password", "password",
                     isSignUp ? "new-password" : "current-password");

    const form = el("form", { className: "account-form" }, [
      email.node,
      pw.node,
      isSignUp ? el("p", { className: "account-note", textContent: "At least 8 characters." }) : null,
      el("button", { className: "btn btn-primary btn-block", type: "submit",
                     textContent: isSignUp ? "Create account" : "Sign in" }),
      error,
    ]);

    form.onsubmit = async (e) => {
      e.preventDefault();
      if (busy) return;
      setBusy(true); error.hidden = true;
      try {
        if (isSignUp) await account.signUp(email.input.value, pw.input.value);
        else await account.signIn(email.input.value, pw.input.value);
        mode = "account";
        render();
      } catch (err) {
        setBusy(false);
        fail(err);
      }
    };

    body.append(form);

    if (!isSignUp) {
      body.append(el("button", {
        className: "btn btn-ghost btn-block", textContent: "Forgot password",
        onclick: () => { mode = "forgot"; render(); },
      }));
    }

    body.append(el("button", {
      className: "btn btn-ghost btn-block",
      textContent: isSignUp ? "I already have an account" : "Create an account",
      onclick: () => { mode = isSignUp ? "signin" : "signup"; render(); },
    }));
  }

  // Re-render whenever the session changes, so a sign-in that completed in
  // another tab (or a Google round trip) is reflected without a reload.
  account.onChange(() => {
    if (document.getElementById(sheetId)?.hidden === false) {
      if (mode !== "reset" && mode !== "forgot") {
        mode = account.signedIn() ? "account" : "signin";
        render();
      }
    }
  });

  return {
    open(next) {
      mode = next ?? (account.signedIn() ? "account" : "signin");
      render();
      openSheet(sheetId);
    },
    close() { closeSheet(sheetId); },
    /** Called by app.js when init() found a reset token in the URL. */
    openReset(token) {
      resetToken = token;
      mode = "reset";
      render();
      openSheet(sheetId);
    },
  };
}
