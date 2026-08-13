---
description: Build the Kairos presentation decks — investor, design partner, or teammate
argument-hint: "[investor|partner|team|all]"
---

# Build the Kairos deck

Locked 13 August 2026. Do not build these until the owner asks — they are for
**when the build is complete and Exousia is ready to engage**, not before.

Audience requested: **$ARGUMENTS** (if empty, ask which of the three, or `all`).

---

## Before you build anything

1. **Read the repo, not your memory.** Every claim, number and feature name
   comes from `app/README.md`, `app/server/schema.sql`, and the route files.
   Recount endpoints, tables, screens and suites — do not carry forward the
   figures below or from any earlier session.
2. **Check deployment status honestly.** Look at whether `DATABASE_URL` is
   actually set on the live service before writing anything about status. If
   the app is still on ephemeral storage, the deck says so plainly. Never
   describe it as live while it is not.
3. **Re-run the suites** and state the real result. If something is red, the
   deck does not claim it is green.

Facts as of the lock (recount them, do not reuse): 144 endpoints · 33 tables ·
47 screens · 19 suites · ~15.4k lines.

## The three decks

All three share the design system and the live cascade demo. What changes is
what leads, what gets cut, and what gets added.

### `investor`
**Leads with the wedge.** The chain-not-a-list observation, then the live
cascade, then the moat (404-not-403, absent-not-refused, structural-not-flag,
honest-about-unbuilt) framed as *what a competitor cannot copy from a feature
list*. Keep the honest-status section — it is a credibility asset with this
audience, not a liability.
**Add:** market shape (who pays, and whether it is the principal or the
household), pricing posture, and why Nigeria/London is an advantage rather
than something to explain away.
**Cut:** implementation detail beyond one engineering section.

### `partner`
For an assistant or principal being asked to use it for real.
**Leads with a day.** Open on the day-in-the-life, not the thesis: a real
morning, running late, the driver told, the flight held. The cascade demo is
the hero and should sit near the top.
**Add:** what the first month actually looks like — setup time, what Exousia
does for them, what they are being asked to give (feedback, and a real diary).
State clearly what is *not* built yet, since they will hit it in week one.
**Cut:** moat framing, market, engineering internals. They do not care and it
reads as pitching.

### `team`
For someone joining or already building.
**Leads with the architecture.** The dual-backend interface, listen-first
startup, additive migrations, the two-register messaging model, and the access
model as a set of invariants to preserve.
**Add:** a map of the codebase — `lib/` by responsibility, where the load-
bearing decisions live (`cascade.js`, `spaceAccess.js`, `household.js`,
`db.js`), the migration discipline (columns and their indexes go in
`lib/db.js` after `ensureColumn`, never in `schema.sql`), and how to run the
suites against all four database configurations.
**Cut:** the pitch. Keep the *why* behind each invariant, because that is what
stops someone undoing one by accident.

## Design system — locked, reuse exactly

Grounded in the app's own palette so the deck and the product agree.

- **Light:** ground `#F6F4EE` · sheet `#FFFDF8` · ink `#191D22` · muted
  `#6A6558` · rule `#DFDACD` · accent `#3E6357` · warn `#8A6A24` · stop
  `#A63F34`
- **Dark:** ground `#14171A` · sheet `#1B1F23` · ink `#ECE9E0` · muted
  `#98938A` · rule `#2E343A` · accent `#7BAA98` · warn `#C7A45C` · stop
  `#D9796B`
- **Type:** prose and headings in `'Iowan Old Style', 'Palatino Linotype',
  Palatino, 'Book Antiqua', Georgia, serif`. Labels, times and data in
  `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace`,
  uppercase, tracked. No sans anywhere. Prose in a book face, time in a
  machine face — the two voices of a day sheet.
- **Layout:** a left time-rail of monospace section labels beside a single
  content column, collapsing above the content under 820px. Hairline rules
  between leaves. Prose capped near 62ch.
- **Theme:** three states — bare `:root` for light, `@media
  (prefers-color-scheme: dark)` guarded as `:root:not([data-theme="light"])`,
  and `:root[data-theme="dark"]`. Never declare a colour only inside a media
  or `[data-theme]` block. `body` sets an explicit background token.

## The live cascade demo

Reuse it in all three. It is the strongest thing in the deck: a slider over a
five-item day, running the same two rules as `app/server/lib/cascade.js` — a
gap absorbs and stops the ripple, an anchor never moves and reports how late
you would be. The arc is deliberate: at 20 min almost nothing, at 45 and 90 a
gap swallows it, and only at 120 does the flight break. Keep that arc; it
teaches both rules without a word of explanation.

If `cascade.js` has changed, re-derive the demo from it so the page cannot
drift from the product.

## Non-negotiables

- Load the `artifact-design` skill before writing the page.
- Verify in a real browser at desktop and mobile widths, in **both** themes,
  with zero console errors and no horizontal overflow, before publishing.
- Publish each deck to its **own** artifact URL; do not overwrite another
  audience's deck.
- Title is a name, not a caption. `Kairos by Exousia` is taken by the
  prototype — give each deck its own specific name.

## Reference

The prototype, built 13 August 2026 and leaning investor:
https://claude.ai/code/artifact/4e85407b-0b0b-43eb-b76c-3e28b46d614a

Treat it as the design reference and a starting point for `investor`. Its
content is out of date the moment the build moves on — regenerate, do not
copy.
