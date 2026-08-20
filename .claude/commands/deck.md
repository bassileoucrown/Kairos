---
description: Build the Kairos presentation decks — investor, design partner, teammate, or developer
argument-hint: "[investor|partner|team|dev|all]"
---

# Build the Kairos deck

Unlocked 19 August 2026 — the owner asked, and four documents now exist. These
are the live URLs; **update them, do not publish rivals**:

| Audience | Document | URL |
|---|---|---|
| `investor` | The Chain, Not the List | https://claude.ai/code/artifact/1509661e-993b-42a4-9e09-722b85b29ace |
| `team` | Inside Kairos | https://claude.ai/code/artifact/6cb74d4c-e5a6-436d-bdef-69d600301235 |
| `team` (full) | The Kairos Handbook | https://claude.ai/code/artifact/45ab7cab-e109-4e3c-bc52-4bc84c34f38a |
| `dev` | Building on Kairos | https://claude.ai/code/artifact/44f381d3-c702-4b62-9136-9fe9c3ea0bff |

Each is also committed at `docs/investor-deck.html`, `docs/teammate-deck.html`,
`docs/founder-handbook.html` and `docs/developer-handover.html` — edit the file
in the repo, then republish it to the URL above so the two never diverge.

`partner` has not been built. `team` deliberately split in two: a half-hour
orientation everybody reads, and the handbook behind it for anyone who needs the
whole thing.

Audience requested: **$ARGUMENTS** (if empty, ask which, or `all`).

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

Facts as of 19 August 2026 (recount them, do not reuse): 183 endpoints across 30
routers · 42 tables · 31 client routes · 51 suites · ~23k lines · 17 connectors,
all of them still returning not-implemented.

Test status, measured 19 August 2026: a back-to-back run of all 51 suites gives
**50 passed, 1 failed**. The one is `bfail`, which asserts on database failure
modes and needs a real Postgres at 127.0.0.1:5432 that the container does not
have. Every suite now spawns its own server, so run order no longer affects the
result. Recount and re-run before writing any status claim, and never write
green while anything is red — name the failure instead.

## The four decks

All share the design system. The live cascade demo belongs to `investor`; the
others carry it as a static figure, because a slider is a distraction in a
document somebody is reading for reference. What changes is what leads, what
gets cut, and what gets added.

### `investor`
**Leads with the wedge.** The chain-not-a-list observation, then the live
cascade, then the moat (404-not-403, absent-not-refused, structural-not-flag,
honest-about-unbuilt) framed as *what a competitor cannot copy from a feature
list*. Keep the honest-status section — it is a credibility asset with this
audience, not a liability.
**Add:** market shape (who pays, and whether it is the principal or the
household), pricing posture, and why Nigeria is an advantage rather
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
For anyone joining Exousia, in any role — not only engineers.
**Leads with the company, then the chain.** What we are building, the two rules
of the cascade shown on a broken day, custody as the second half, the six
principles, what works today and what does not, and a first week.
**Add:** how to talk about Kairos outside, including the rule that nothing is
described as working when it is not, and that credentials never travel through
a conversation.
**Cut:** architecture and market. Both live elsewhere.

Behind it sits **The Kairos Handbook** — the same ground in full, section by
section, with the reasoning that produced each decision. Twenty-two sections
with their own contents rail. Update this whenever a subsystem changes; it is
the document that goes stale first.

### `dev`
For someone about to change the codebase.
**Leads with the architecture.** The dual-backend interface, listen-first
startup, additive migrations, the four separate access systems, and a list of
invariants each tied to the suite that enforces it.
**Add:** a map of `lib/` by responsibility, the four database configurations and
why the fourth is the one people skip, the real current test status with every
failure accounted for, the outstanding work written as tasks with what already
exists, and the traps already fallen into.
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

It is the strongest thing in the investor deck: a slider over a five-item day,
running the same two rules as `app/server/lib/cascade.js` — a gap absorbs and
stops the ripple, an anchor never moves and reports how late you would be.

The day, and the arc it produces, are already tuned. Keep both:

    09:30–10:15  Board pre-read          travel  0   ← the delayed one
    10:30–11:15  Call with counsel       travel  0   external attendee
    12:15–13:30  Lunch, Eko Hotel        travel 30
    14:15–16:45  Car to the airport      travel 15   household driver
    17:10        BA75 to London          ANCHOR

     20 min → one leg moves, nothing else changes
     45 min → one leg moves, the lunch gap absorbs the rest
     90 min → three legs move, the flight is made with 10 min to spare
    120 min → the flight is missed by 20 min, and says so

Twenty and forty-five teach that a gap absorbs; ninety teaches that the ripple
travels and still stops; a hundred and twenty teaches the anchor. Do not report
"minutes to spare" unless the ripple actually reached the car — otherwise the
number is about the middle of the afternoon and the sentence says "flight".

If `cascade.js` has changed, re-derive the demo from it so the page cannot
drift from the product.

## Non-negotiables

- **One office, not two.** Exousia is Lagos, Nigeria. Do not write anything
  that implies the company also operates from London — no "Lagos & London"
  strapline, no second address. London is fine everywhere else it belongs: as a
  destination in flight and trip examples, as the easier market the Lagos-first
  argument compares against, and in the app's own timezone fixtures.

- Load the `artifact-design` skill before writing the page.
- Verify in a real browser at desktop and mobile widths, in **both** themes,
  with zero console errors and no horizontal overflow, before publishing.
- Publish each deck to its **own** artifact URL; do not overwrite another
  audience's deck. The four that exist are listed at the top of this file —
  republish those paths rather than creating rivals.
- Keep the repo copy in `docs/` and the published artifact identical.
- Title is a name, not a caption. `Kairos by Exousia` is taken by the
  prototype — give each deck its own specific name.
- `checkdecks.js` in the scratchpad drives all four through Chromium in both
  themes at both widths and asserts the demo arc. Rewrite it if it is gone;
  publishing without it has no way of catching a theme that never resolves.

## Reference

The prototype, built 13 August 2026 and leaning investor:
https://claude.ai/code/artifact/4e85407b-0b0b-43eb-b76c-3e28b46d614a

Treat it as the design reference and a starting point for `investor`. Its
content is out of date the moment the build moves on — regenerate, do not
copy.
