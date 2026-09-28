# Sportsbook — bug log

**A bug that comes back a second time gets an entry here BEFORE it gets a
fix.**

This file exists because of a real case in another app on this kit, where one
bug was "fixed" and shipped **thirteen times** — and several of those attempts
were *the same idea twice*, because nobody had written down that it had
already been tried and ruled out. Writing the hypothesis down costs two
minutes. Not writing it down cost that project weeks.

It is not a changelog. A bug that was found and fixed once does not belong
here. A bug that **came back**, or that survived a fix, does.

## How to write an entry

Write the **hypothesis** and the **change** when you make it. Then **come
back** and write what actually happened — that second half is the entire
value of the file, and it is the half everybody skips.

The outcome must be one of these four words. The closed vocabulary is what
makes the file scannable:

- **CONFIRMED FIXED** — somebody verified it on the real device, with the real
  service, under real conditions. *Only a human holding the thing can write
  this.* An agent may never promote an entry to this on its own.
- **SHIPPED, UNVERIFIED** — the change is in, the reasoning is sound, nobody
  has confirmed anything. **This is the honest default.** Most entries stay
  here, and that is fine.
- **RULED OUT** — evidence showed this was not the cause. **Say what the
  evidence was**, or the next session cannot tell your conclusion from your
  opinion.
- **MADE IT WORSE** — say so plainly, and leave it in. **These are the most
  valuable entries in the file** and the ones nobody volunteers.

**Never upgrade an entry to CONFIRMED FIXED because the reasoning got
better.** Finding a mechanism is not confirming a cause. That distinction is
what stopped the other project shipping "fixed" a fourteenth time.

---

## Case: <short name for the recurring bug>

**Symptoms, as reported.** Number them. One reported symptom is usually
several different bugs, and they often have opposite fixes — "no photos"
turned out to be at least four. Keep the reporter's own words; an engineer's
paraphrase throws away the detail that identifies which one it is.

1.
2.

**What is known for certain.** Evidence, not inference. A screenshot, a
status code, a log line, a response body.

**What is still NOT known.** Keep this honest and keep it current. It is the
section that stops the next session re-deriving something you already ruled
out — and the section that makes it obvious when nobody has actually looked
at the real thing yet.

**What would settle it, cheapest first.** Usually this list ends at something
only a human can do: run it on a phone, hit the real API from a machine with
a network route, look at it. **Get that onto the "Waiting on a human" list in
`CLAUDE.md` early** — until someone runs it, you are not debugging, you are
speculating in public.

### Attempts

| # | Date | Commit | Hypothesis | Change | Outcome |
|---|---|---|---|---|---|
| 1 | | | | | |

---

## Before you add attempt N+1

Six questions, all of which cost another project real time:

1. **Is it already in the table above**, marked RULED OUT or MADE IT WORSE?
2. **What build was the report from?** The app prints its build number in the
   toolbar and in Settings, read from `caches.keys()`. A screenshot with no
   version chip predates the fixes it is being measured against, and *"is that
   fixed?"* was asked three rounds running before anyone noticed. **Ask for
   the build line before diagnosing anything.**
3. **Can you reproduce it?** An attempt with a reproduction behind it is a
   different kind of claim from an attempt with a hypothesis behind it. And
   if your new test **passes first try**, be suspicious — it may be passing
   for the wrong reason, which is worse than having no test.
4. **Does your fix heal the devices that already have the bad state?** Every
   phone that ran the broken build is carrying records it wrote. A fix that
   only helps first-time users fixes nothing anyone can see — and gets
   reported as "still broken", twice.
5. **Would an instrument beat another guess?** After ten failed attempts, the
   thing that finally moved the other project was shipping a change that made
   the failure *say what happened* rather than another change that hoped.
6. **Has anything here actually met the real third party?** If the only check
   is your own stub, the stub was written from the same reasoning as the code
   and **cannot falsify it**. That is what hid the real cause for twelve
   attempts.
