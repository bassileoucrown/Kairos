# Kairos App

A real, working build of Phase 1 from the master blueprint (Section 7.2), plus the start of
Phase 2A. Sign up, set your weekly availability, create meeting types with real access tiers, let
people book you with correct timezone handling, and — once you invite a PA — route the sensitive
bookings through an approval queue instead of straight onto your calendar.

## Stack

- **Server** — `app/server`: Express + Node's built-in `node:sqlite` (experimental, ships with
  Node 22+, zero native dependencies to install). Session-cookie auth with scrypt password
  hashing — no external auth provider wired up yet.
- **Client** — `app/client`: React + Vite, plain client-side routing via `react-router-dom` v7.
  No UI framework dependency — a small hand-rolled design system in `src/styles.css`.

This mirrors the blueprint's target stack (React + Vite frontend, Postgres-backed backend) without
requiring a Supabase project to start developing. See "Moving to Supabase" below for the swap path.

## Running locally

Two processes: the API server and the Vite dev server (which proxies `/api` to the server).

```bash
# Terminal 1
cd app/server
npm install
npm run dev        # http://localhost:4000

# Terminal 2
cd app/client
npm install
npm run dev         # http://localhost:5173
```

Open `http://localhost:5173`, sign up, and walk through onboarding. Your booking page will be at
`http://localhost:5173/book/<your-slug>` — open it in a different browser (or an incognito window,
since it uses a separate session) to book as a visitor.

### Single-process production mode

```bash
cd app/client && npm run build
cd ../server && npm start     # serves the built client + API on one port (4000)
```

## Deploying

`render.yaml` at the repo root is a Render Blueprint for exactly the above: one web service where
the Express server serves the built client too. In the Render dashboard go to **New → Blueprint**,
pick this repo, and apply — build and start commands, and the Node 22 requirement for
`node:sqlite`, are already set.

Two things to know on the free plan: instances sleep after ~15 minutes idle (first request back is
slow), and the filesystem is ephemeral with no persistent disk, so `server/data/kairos.sqlite` —
and every account in it — resets on each restart or deploy. Fine for trying the app out; for data
that sticks around, use a paid instance with a disk mounted at the data directory, or port `db.js`
to Postgres (see "Moving to Supabase" below).

## Phase 1 — the core loop (complete)

- **Auth** — email/password signup and login, scrypt password hashing, httpOnly session cookies,
  and password reset (emailed single-use token, expires in 1 hour, invalidates every existing
  session on use). The forgot-password endpoint gives an identical response whether or not the
  email matches an account, and never returns the reset link itself — only `sendEmail` sees it.
  No real email delivery is configured, so accounts are marked verified immediately on signup —
  replace this with real verification before any real user data touches it.
- **Onboarding** — profile (name, booking-link slug, timezone) → first meeting type → dashboard.
  Availability is deliberately *not* an onboarding step: picking the hours you'll actually be
  bookable is a real decision, not a form to rubber-stamp during signup. Nothing is defaulted on
  your behalf either, so until you set hours your booking page offers nothing — the dashboard says
  so plainly, with a button straight to the editor, rather than letting you find out from an empty
  public page.
- **Availability** — a weekly recurring schedule, set from the dashboard's Availability tab and
  editable whenever. Each day holds **any number of time blocks**, not one unbroken stretch, so
  "9–12 and 2–5" (lunch protected), mornings-only, or a separate evening window are all first-class.
  Blocks are stored as `day_of_week` + `HH:MM` start/end in the owner's own timezone; the API
  rejects blocks that overlap within a day, since overlapping windows would emit duplicate slots.
- **Meeting types** — name, duration, format (video/phone/in-person), buffers, color, and a real
  **4-tier access control** (Public/Standard auto-confirm; Priority/Inner Circle hold as `pending`
  until approved) — the gap-closing feature named in the blueprint's own positioning (Section 1.1).
- **Public booking** — computes real open slots for the next 14 days from availability rules minus
  existing bookings (pending bookings hold their slot too), lets the visitor pick their own
  timezone, and re-validates the target slot live at submit time (no double-booking).
- **Booker-side reschedule/cancel** — every booking gets a private manage link (`/book/manage/:id`)
  where the booker can move it to a different open slot or cancel outright. Closes the Phase 1
  blocker in Section 3.6 (Gap 1).
- **Calendar view** — a real month grid on the dashboard, appointments color-coded by meeting type.
- **In-app video** — video-format bookings get an auto-generated Jitsi room (`meet.jit.si`, no API
  key needed for basic rooms), surfaced on the confirmation, manage, and dashboard views.
- **Email** — a swappable email service (`server/lib/email.js`) sends booking confirmations,
  pending-approval notices, reschedule/cancel notices, invites, and password resets. Every email
  is logged to an `emails` table and viewable in the dashboard's Outbox tab — useful since no real
  provider is configured by default — and also printed to the server console, which matters for
  flows like password reset where the recipient is, by definition, locked out of their own Outbox.
  Set `RESEND_API_KEY` (and optionally `EMAIL_FROM`) to also deliver for real.
- **Members & Delegates** — invite a PA or delegate by email; they accept via a link (going through
  their own signup/onboarding first if needed) and get access to your account.
- **Calendar sync / WhatsApp — stubbed, not faked.** Real architecture (`server/lib/calendarSync.js`,
  `server/lib/whatsapp.js`, the `calendar_connections`/`whatsapp_connections` tables, a Settings tab)
  exists, but every entry point honestly reports "not configured" until real OAuth/API credentials
  are set as env vars (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`,
  `WHATSAPP_BUSINESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`). Nothing pretends to sync or send.

## Phase 2A — the PA layer (complete)

The category-defining piece per the blueprint (Section 7.3: "what makes Kairos not-Calendly").
An invited PA gets a PA Home (`/pa`) scoped to whichever principal(s) they support — including
themselves, so the approval workflow is useful even solo, before ever inviting anyone:

- **Approval Queue** — Tier 3/4 bookings land here instead of the calendar; the PA approves
  (confirms + emails the booker) or declines (frees the slot + emails the booker).
- **Contact Intelligence** — every booker becomes a contact automatically, and a PA can also add one
  by hand (`POST /:ownerId/contacts`, an "+ Add contact" form on the Contacts tab) for people the
  principal knows who haven't booked yet; either way the PA can add notes and set a relationship
  tier (Inner Circle / Close / Professional).
- **Brief Builder** — a structured, multi-section brief per booking.
- **Instructions Vault** — free-text instructions with priority and open/done status. Voice capture
  is deferred — it needs a transcription API key (e.g. Whisper) that isn't configured.
- **Communications Engine** — the PA composes and sends email to a contact on the principal's
  behalf, through the same email service (and outbox) as the rest of the app.

## Phase 2B — Relationship Intelligence + AI Assistant (complete)

Deepens Executive retention per the blueprint (Section 7.4), built on top of Phase 2A's Contact
Intelligence:

- **Relationship Calendar** — contacts get an optional birthday and anniversary (`MM-DD`, set from
  the Contacts tab). The Relationships tab shows what's coming up, soonest first, with Inner Circle
  contacts flagged — the 3-tier system from the blueprint's positioning (Section 1.1), reusing the
  same relationship tier as Contact Intelligence rather than a second, separate one.
- **AI Scheduling Assistant** — a PA types a plain-language request ("book a call with Jane next
  Tuesday afternoon"); it extracts a contact, meeting type, and date/time hint
  (`server/lib/aiAssist.js`) and filters the *real* computed open slots down to matching candidates.
  No LLM API key is configured in this environment, so extraction is pattern-based rather than a
  model call — but it's a genuine working feature on real data, not a stub, and nothing books
  itself: every candidate still needs an explicit PA click (`POST /:ownerId/ai-assist/book`),
  matching the blueprint's "PA approves every output — never autonomous" (Section 3.2). A PA
  booking directly this way lands as `confirmed` immediately, regardless of the meeting type's
  tier — the PA's click *is* the approval.
- **AI message drafting** — the AI Assist tab's second mode. A PA describes what a message needs to
  say ("follow up thank-you after our call with Jane"), optionally picks a contact and/or booking
  for context, and gets an editable subject/body drawn from a fixed set of intent-matched templates
  (reschedule, cancel, follow-up, confirm, introduction, birthday/anniversary greeting, apology,
  general — `draftMessage` in `server/lib/aiAssist.js`). Nothing sends until the PA clicks Send,
  which goes through the same Comms endpoint (and Outbox) as a hand-written message.
- **AI brief pre-fill** — a "Draft with AI" button on the Brief Builder (`POST
  /:ownerId/briefs/:bookingId/draft`) fills the Who, Background, and Logistics sections from real
  contact history (meeting count, last meeting, relationship tier, PA notes, birthday/anniversary)
  — only for sections still empty, so it never clobbers what a PA already wrote. Talking points and
  desired outcome are left for the PA, since those need actual judgment about the meeting.

## Phase 3A — Spaces and the two registers (complete)

The collaboration layer from `docs/collaboration-spec.html`. Its point is one mechanic: the formal
record is produced *by* the informal conversation instead of being written separately from it.

- **Spaces and contexts** — every thread lives in a space, and every space is
  **Work**, **Personal**, or **Private**. Nothing crosses that boundary. All access resolution goes
  through `server/lib/spaceAccess.js`; there is deliberately no second path.
- **Private is structurally unshareable** — not "a space whose members were removed". The route
  refuses to create a member row against a private space, and `resolveAccess` short-circuits before
  even consulting `space_members`, so a stray row from some future bug still can't open the door. A
  principal shouldn't have to trust a boolean.
- **Invisible, not forbidden** — a space you can't see returns 404, never 403. Confirming a space
  exists is itself disclosure.
- **Role sets the default, not the ceiling** — `account_category` now does real work. Work spaces
  auto-delegate to PAs, EAs, and Chiefs of Staff; Personal spaces to nobody until the owner opts a
  role in per space; Private to nobody, ever. These roles are *not* a ladder — a PA often has more
  personal reach than a Chief of Staff — so the role picks a starting bundle the principal tunes.
  The one genuinely hierarchical capability is onward delegation, which only a Chief of Staff has.
- **Two registers in one timeline** — **notes** are chat (sans, soft bubble); **records** are
  structured, citable entries (serif, bordered, badged, numbered `R-01`). You can see which parts of
  a long thread are binding without reading a word.
- **Promote** — any note becomes a record in one click, carrying the original wording, author, and
  timestamp, with a permanent link back. Promotion is *clerical, not authoritative*: the record
  shows both whose words these are and who filed them, so an assistant recording their principal's
  decision is the intended use rather than a loophole.
- **Records lock on acknowledgement** — the first ack freezes the body. After that, disagreement has
  to take the form of a **superseding** record, so an acknowledged decision can never be edited out
  from under the people who acknowledged it.
- **Records-only view** — filters the thread to its formal spine: the audit trail you could hand to
  a board secretary, with the texture that produced it still underneath.

Isolation is covered by direct API tests rather than only clicked through in a browser, since access
control is worth exactly as much as its proof.

## Phase 3B — Projects and stages (complete)

A project lives in exactly one space, so it inherits that space's context and isolation rather than
carrying its own. Each project holds ordered stages, and **every stage gets its own thread on
creation** — a stage with nowhere to talk about it is the exact split this is meant to close.

**Records drive stage status**, which is what stops the formal register being ceremony:

| In the thread | On the board |
|---|---|
| Blocker filed (or a note promoted to one) | stage → **blocked** |
| Blocker resolved or superseded by an Update | stage → **active** |
| Sign-off accepted | stage → **done** |

Status is stored rather than derived, so an owner can set it by hand — but an open Blocker outranks
a manual change and the API refuses it with a reason. A board claiming "active" while a Blocker
everyone can read sits in the thread is precisely the disconnect this exists to remove.

Superseding keeps the original's record type unless the replacement names its own. That distinction
matters for Blockers: replacing one with another Blocker *restates* the obstacle and the stage stays
blocked, while replacing it with an Update lifts it. Blockers also carry a `resolved` status, since
"accepted" and "declined" are both the wrong word for what happens to an obstacle.

## Phase 3C — Tasks and reminders (complete)

Tasks attach to a stage, a project, or just a space (a loose to-do). The one that matters:
**any message becomes a task in one click**, the same gesture as promoting it to a record, and for
the same reason — the thing you need to do next almost always gets said in passing, and retyping it
somewhere else is where it gets lost. The task keeps a `source_message_id`, so opening it later
shows you the conversation that explains why it exists.

- **Access is inherited, never asserted** — a task made from a message takes its space, project, and
  stage from that message, so a caller can't smuggle work into a space they can't reach. You can
  only assign work to someone who can already see where it lives.
- **My Tasks** spans every context in one list, each row labelled Work / Personal / Private and
  filterable down to one, banded by Overdue → Due within a day → everything else.
- **Reminders** (`server/lib/reminders.js`) sweep on an interval and email the assignee once when a
  task is a day out and once again when it goes overdue. A `reminder_stage` column tracks how far
  the nudging has got, so each threshold fires exactly once; changing the due date, reassigning, or
  reopening deliberately re-arms it. Stage deadlines nudge their owner the same way. Delivery rides
  the existing email service, so with no provider configured these are still visible in the Outbox
  tab and the server log. Set `REMINDER_SWEEP_MS` to change the interval (default 15 minutes).

## Account categories

At signup, an account declares itself **Principal**, **PA / EA**, or **Chief of Staff**
(`users.account_category`) — this only decides where onboarding lands and what the default view is,
not what the account is permitted to do: every account can still be invited as a PA for someone
else, and any PA/EA/Chief of Staff account can still open its own bookable calendar later via
Dashboard → Settings. Principal accounts get the full onboarding (profile → meeting type) and land
on the Dashboard; PA/EA/Chief of Staff accounts skip straight to PA Home after the
profile step, where they manage whichever principal(s) have invited them (or, before anyone has,
their own account solo — the approval queue and AI Assist still work standalone).

## Timezone handling

Every stored instant (bookings, computed slots) is UTC. Availability rules are stored as
`day_of_week` + `HH:MM` in the *owner's* timezone. Slot generation (`server/lib/availability.js`)
walks the owner's calendar days, converts each rule's start/end time to a UTC instant
(`server/lib/timezone.js`, using `Intl` — no date library dependency), and only then compares
against existing bookings. The public booking page asks the visitor for their timezone (defaulting
to what their browser reports) and renders every slot in it, while showing the owner's timezone
alongside for clarity — this was an explicit Phase-1 gap in the blueprint (Section 3.6, Gap 2) and
is handled from the start here rather than retrofitted.

## What's deliberately not here yet

Per the blueprint's own phasing (Section 7): multi-group management (independent scheduling
environments per group, group switcher), Family Office infrastructure (Phase 3), and everything
past Phase 2B.

## Moving to Supabase

`app/server/lib/db.js` is the only file that knows about SQLite. The schema in `schema.sql` was
written to stay close to standard SQL (explicit foreign keys, ISO-8601 text timestamps, UUID text
ids) specifically so a Postgres/Supabase port is a matter of re-pointing this module at a Postgres
client and enabling Row Level Security per the blueprint's security architecture (Section 5) — not
a rewrite of the route or slot-computation logic, which talk to `db` through plain SQL calls.
