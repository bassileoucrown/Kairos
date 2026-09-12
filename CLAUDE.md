# Working notes for Claude

## Deliverables go as FILES, not artifacts

The owner's instruction, 3 September, after a training course was published
three times and none of the three would open for them.

Published artifacts do not load on the owner's machine. All three versions
spun forever — and they were structurally very different from one another
(7.8MB, then 3.4MB with the webfont unblocked, then 3.05MB rendering only what
is on screen), so the content was never the variable. Older artifacts from
August behaved the same way. The likeliest cause is their client rather than
any page: the viewer boots the page inside a sandboxed frame that loads its own
runtime first, and if that cannot load, every artifact spins whatever is in it.
That was never confirmed, because it cannot be reproduced from here.

**So send a deliverable with SendUserFile.** A self-contained `.html` file
reached them first time and worked. Do not spend another round tuning a page
that cannot be opened; the diagnosis is not worth the delivery.

Two things that made the file work, worth keeping in anything built next:
everything inline, so nothing is fetched at open time, and the one external
thing it does want — a webfont — arrives as a `media="print"` stylesheet
promoted by script after paint, so an unreachable font host costs the page its
typeface and not its existence.

Revisit if the owner ever reports an artifact opening normally.

## Pushing

Two separate acts, two separate rules.

**The branch — push on every commit.** Nothing consumes
`claude/kairos-landing-waitlist-13dhgm`: `render.yaml` names no `branch:`, so
Render deploys the default branch, and there are no GitHub Actions. A red tip
on the branch costs nothing, and the container is ephemeral — work that lives
only on local disk is one reclaim away from gone.

**`main` — fast-forward only when both boards are green.** `main` is what
deploys. This is where the gate earns its keep.

Revisit if a PR with preview deploys or branch CI ever appears; branch pushes
would then have consequences again.

## Both boards

Green means both, back to back, from the repository root:

```
bash app/tests/allsuites.sh                      # SQLite
node app/tests/resetpg.js
DATABASE_URL=postgres://kairos:kairos@127.0.0.1:5432/kfresh \
  bash app/tests/allsuites.sh                    # Postgres
```

SQLite is the more permissive backend, so a statement it accepts can still be
rejected by Postgres. Running only one board is running half a board.

## Three things that have each cost an hour

**The client is a build artifact.** The server serves `app/client/dist`, which
is not tracked by git (Render builds it). Any change under `app/client/src` is
invisible to a test until `npx vite build` runs in `app/client`. Editing `src`
mid-board is safe; rebuilding `dist` mid-board contaminates the run.

**59 suites delete `app/server/data/kairos.sqlite` at startup, unconditionally
— there is no `DATABASE_URL` check.** So a SQLite run started alongside a
Postgres board has its database unlinked underneath its live server, and the
symptom is a 401 or a vanished row a long way from the cause. Never run a suite
concurrently with a board.

**Absolute paths in shell commands.** The working directory persists between
calls; a `cp` or a `node` run from a directory left over from an earlier command
fails silently or misleadingly. This has produced two false results.

## Standing instruction: the tier structure stays OFF

The owner's words, 3 September: *"Dont activate tiers structure yet. I want
testers to be able to use every feature before we activate tier structures."*

So `PLAN_ENFORCEMENT` is set nowhere but `app/tests/bplan.js`, and that is
correct rather than an oversight. Do not set it in `render.yaml`, in the
deployment, or as a default in `lib/plans.js`. A tester blocked by a paywall on
the thing they were asked to test is a finding that never arrives.

Three separate things are all off, and it is worth not confusing them:

- **The gate.** `lib/plans.js` line ~368: `if (!ENFORCED) return next();`.
  Fifteen of twenty-three features carry a real `requirePlan(...)`, so flipping
  the flag would start gating them immediately. That is the point of leaving it
  unflipped.
- **The meter.** `meterUse()` records a usage row and reads nothing back. The
  allowances in the tier sheet are a plan, not a limit anybody is hitting.
- **Billing.** There is none — no Stripe, no Paystack, no Flutterwave, no
  subscription table. `users.plan` is a column somebody would set by hand.

Turning any of it on is the owner's call and needs the eight unwired features
(below) decided first. Raise it, do not do it.

## Held for the owner — do not decide these

Written down rather than remembered, because a context reset loses anything that
is only in a conversation. These are the owner's calls. Do not act on any of
them, do not quietly pick a default, and do not let one drop off this list
because it stopped coming up. Raise them only when asked.

1. **The eight unwired plan features.** Twenty-three features are named in
   `lib/plans.js`; fifteen are wired to real code and eight are named on the
   ladder with nothing behind them: `direct_line` and `own_report` (Standard),
   `voice_notes`, `archive` and `office_report` (Plus), `held_for_others`
   (Executive), `many_principals` (Family Office), `sso` (Enterprise). Each one
   is either to be wired or struck from the sheet. Owner's call, one by one.

2. **The "Your decision" column** in the *Features By Plan* sheet — still empty
   by intent.

3. **Standard/Plus naming.** The code's canonical rungs are `principal` and
   `office`; `standard` and `plus` are aliases that already resolve. Renaming is
   cosmetic and would touch stored `users.plan` values. Recommended: leave it.

4. **The thread composer losing typed input** when the thread renders late.
   Real, reproducible, small. Not fixed because it was never asked for.

5. **Whether a held principal's itinerary entries default to confirmed.**
   Related to, but not the same as, the hand-over defect (that one is a bug in
   what was shipped, and is fair to fix without asking).

Also still unbuilt and not to be started unasked: desk-scoped billing; the
written delegation recorded at setup; mail drafting and sending (the grant
carries `sendMode` and nothing consumes it).

## Deferred on purpose — each with the thing that brings it back

Different again from both lists around it. These are not decisions waiting on
the owner and not finished work missing a screen: they are known gaps the owner
has looked at and chosen to leave, with a condition attached. The condition is
the point — "later" with nothing to trigger it is how a deferral becomes an
omission — so each entry says what has to be true before it is worth doing, and
none of them is to be started before that.

1. **`List-Unsubscribe` on broadcast mail.** Owner's decision, 12 September,
   after publishing a notice was wired to knock: *"leave it for now"*.

   There is no opt-out of any kind. Every published notice reaches every
   address it is aimed at, and `lib/email.js` records a category while
   suppressing nothing.

   **The reason this comes back is not the legal one.** A notice that tells
   ("maintenance Sunday") is service mail nearly everywhere and needs no
   opt-out; a notice that sells needs one under CAN-SPAM, GDPR/ePrivacy and the
   NDPA — so the exposure arrives with the first broadcast that sells rather
   than tells, which the audience picker makes inevitable eventually. The
   sharper risk is deliverability, and it is not about notices at all:
   confirmations, invites, password resets and the running-late email to a
   booker all leave the same domain through the same provider. A reader with no
   unsubscribe button uses the spam button instead — that is what it is for,
   from their side — and enough of those drops the domain's reputation and
   stops the mail that *must* arrive. Notices poisoning the well for everything
   else.

   **The trigger: the first notice that is not strictly operational, or the
   list outgrowing the tester group.** Google and Yahoo only *require*
   one-click above 5,000 messages a day, so the threshold is judgement, not
   that number.

   **Do the cheap half first.** A `List-Unsubscribe` header gets Gmail and
   Outlook to draw their own native button, which is most of the protection.
   It is not a one-liner: `sendEmail` hands providers a fixed
   `{from, to, subject, text}` with no headers path, so both bodies in
   `lib/emailProviders.js` change, and the header needs somewhere to point —
   `mailto:` is honoured and simplest, true one-click (RFC 8058) needs a POST
   endpoint that works with no session. The full preferences table, tokenised
   links and settings screen is the expensive half and is not worth building
   until there is a list worth protecting.

## The name is "Kairos by Exousia"

The owner's instruction, 7 September: *"name should be Kairos by Exousia going
forward."*

So it is one name, not a product with a publisher's line under it. Anything
outward-facing — decks, infographics, the landing page, a title tag, an email
signature — says **Kairos by Exousia**, and "Exousia Prime Emporium Ltd" is
kept for where a legal entity is actually wanted: contracts, invoices, the
company line in a footer.

Not renamed in code. `app/client/index.html` still titles the app "Kairos by
Exousia" already, and internal identifiers, table names and route paths stay
`kairos` — a name for people is not a reason to touch a schema.

## It is not two people

The owner's correction, 7 September, after two marketing pieces had led with
"one diary, two people": *"its more than 2 two people. for principals with
more than 1 assistant and staffs in their homes."*

That framing was wrong and the code says so. `memberships` is many-per-
principal across three assistant roles — `pa`, `ea`, `chief_of_staff` (see
`lib/roles.js`, `lib/spaceAccess.js`) — so a principal may have several
assistants at once. `household_members` carries a `job_title` and is a
separate population again: house managers, cooks, security. `lib/drivers.js`
is a third. Add the family, and the honest picture is **one principal and the
whole office and household around them**, each seeing only their part.

So: never describe Kairos as a two-sided tool. The principal, their
assistants, their household staff and their family are four different
audiences with four different screens, and the product's actual distinction
is that it keeps them separate rather than that it joins two people up.

## Built, tested, and not yet on a screen

Different from the list above: these are not decisions waiting on the owner,
they are finished work with a missing half. Written down because a feature that
passes its suite and cannot be reached by a person is the easiest kind of work
to forget was ever done, and the second easiest to build twice.

1. **The travel-buffer screen.** `lib/travelBuffer.js`, its route
   `GET /api/itinerary/:ownerId/travel-buffers?from&to`, and `bbuffer` are
   done. For every adjacent pair on a day it returns the drive at the departure
   instant, the margin, the shortfall, whether the lookup was exact (a pinned
   `place_id`) or a phrase, and when the road was actually asked. Nothing
   consumes it. The screen wants: the tight gaps first, the shortfall as the
   headline number, `readAt` shown rather than implied, a "check again" that
   passes `fresh=1`, and applying a suggestion going through the existing
   per-item route one leg at a time — never in bulk, because the point of the
   feature is that a person decides. Inert until `MAPS_API_KEY` is set; the
   endpoint marks every gap `unconfigured` rather than failing.

2. **eslint on the client, with `no-undef`.** Offered, not built. `vite build`
   compiles an undefined variable inside JSX without complaint — it is a
   runtime ReferenceError, not a compile error — and there is no lint config
   or lint script in `app/client`. That is exactly how a `tripId` that did not
   exist in `AddItem`'s scope crashed the whole add-an-item form, took four UI
   suites down, and reached a full two-board run before anything noticed.
   Until this exists, the standing rule is cheaper than the tooling: **after
   any change to a React component, run one UI suite before running a board.**

## Verifying a negative

Asserting that something is absent passes when the code is broken *and* when the
thing was never there. Every high-stakes negative gets a positive control —
break the code deliberately, watch the assertion go red, put it back.

The same applies to a fix: confirm it by reverting it and seeing the failure
return, not by seeing the test pass once. Intermittent failures need a run count,
not a single green.
