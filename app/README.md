# Kairos by Exousia

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
requiring a database to be installed for local development — see "The database" below.

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

## The database — two backends, one interface

`server/lib/db.js` is the only file that knows which database is in use.

- **`DATABASE_URL` set → Postgres.** What production uses.
- **unset → a local SQLite file.** What `npm run dev` uses, so local development still needs no
  database installed.
- **`DATABASE_SCHEMA` (optional, Postgres only)** → keeps every table in a named schema instead of
  `public`. Free Postgres plans generally allow one instance per account, so Kairos may have to
  share one with another app; set this to `kairos` and its `users` table cannot collide with
  anyone else's. The value must be a plain lowercase identifier — it reaches the server as a
  connection startup option and as `CREATE SCHEMA`, neither of which takes a bind parameter, so
  anything else is refused at boot rather than escaped. Column-existence checks are scoped to
  `current_schema()`, without which a foreign `public.users` would make the migrations think our
  columns already existed and skip them.

Both expose the same shape — `await db.prepare(sql).get(...args)` — so no route knows the
difference, and the SQL stays in the portable subset both dialects accept. `db.tx()` runs a
transaction on a single pooled connection, which matters on Postgres where issuing BEGIN and COMMIT
as separate pool queries could land on different connections and silently not transact.

Why this exists: Render web instances have an **ephemeral filesystem**. A SQLite file there is
wiped on every restart and redeploy, taking every account with it — which presents to a user as
*"the app doesn't recognise my email"*, and then as *"there's no password recovery"* when the reset
email for a deleted account never arrives. Postgres fixes both at the root.

Two details the port had to get right, both verified by running the same suite against both
backends: node-postgres returns `int8`/`numeric` as **strings** (so `MAX(record_seq)` of `2` plus 1
would be `"21"`, not `3` — the type parsers coerce them), and Postgres allows a bare column alias in
`ORDER BY` but **not** one nested inside an expression, where SQLite is happy either way.

## Deploying

`render.yaml` at the repo root is a Render Blueprint declaring one web service. In the Render
dashboard go to **New → Blueprint**, pick this repo, and apply.

It deliberately does **not** declare a database. Render allows one free Postgres instance per
account, so a blueprint that creates its own fails with *"cannot have more than one active free
tier database"* for anyone who already has one. Point the service at a database instead: copy the
**Internal Database URL** from any Postgres in the dashboard into `DATABASE_URL` on the service.
Any hosted Postgres works — Neon and Supabase have free tiers with no one-per-account limit. If
that database already serves another app, set `DATABASE_SCHEMA=kairos` alongside it.

Whatever it points at, **the database starts empty**; accounts from an earlier SQLite deployment do
not carry over. Until `DATABASE_URL` is set the app still runs, on ephemeral SQLite, and after a
failed sign-in the login screen says storage is temporary rather than blaming the password —
`GET /api/status` reports `storageDurable`, a property of the deployment and of no account, which
is why it needs no authentication.

### Bringing on an assistant

Two routes, and the second exists because the first depends on infrastructure
the principal cannot see.

**By email.** Team → invite by address. They accept the link and they're in.
The better path when email is actually delivering.

**By code.** The principal sets a pairing code on the same screen: they choose
the phrase, choose what it grants (PA/EA/Chief of Staff, or Delegate), and
choose how long it lives. They read the assistant their handle and the code
over the phone, and the assistant enters both on their Workspace. No mailbox,
no provider, nobody waiting on DNS.

Several codes can be live at once, up to five. Bringing on a Chief of Staff and
a scheduling-only delegate in the same week is two different remits, and each
wants its own phrase, window and use count. Arming one never disturbs another —
an earlier design replaced the previous code on every arm, which would have
silently killed one already given out. Each is listed with what it grants so
the principal can see which is which before turning one off, and the same
phrase cannot be live twice, since redeeming it could then grant either remit.
The cap is there because codes that accumulate are codes nobody reads.

Four things make a bearer credential to an executive's calendar survivable:

- **Handle *and* code.** Not the code alone. Two principals will eventually
  choose the same phrase, and a bare global code would be guessable against
  every account in the system at once. With the handle you must already know
  who you are targeting, and the collision problem disappears rather than
  being papered over with a uniqueness check that would itself leak which
  codes are live.
- **Armed, not standing.** Off by default, live for an hour, a day or a week,
  spent after a set number of joins. A credential that exists only in the
  window it is needed cannot leak six months later out of an old message. The
  Team screen shows each code's countdown and uses left, because a credential
  whose expiry is invisible is one nobody ever turns off.
- **One neutral failure.** A wrong code, an unknown handle, an expired code
  and a spent one all answer identically. The differences between them are
  exactly what a guesser needs.
- **Throttled.** The principal picks the phrase, so it will sometimes be short
  and memorable. Ten attempts an hour per account and per address is what
  makes that survivable.

**Signup itself is open, deliberately.** A deployment-wide code used to guard
account creation; it guarded the wrong door. An account on its own reaches
nothing — a stranger who signs up sees their own empty calendar and no trace
of anybody else, and a known handle does not resolve for them. The compartments
are the security, not the front door. A suite asserts exactly that, walking a
stranger through every principal-scoped endpoint.

### When the database can't be reached

The server **binds its port first** and prepares the database afterwards. This
matters more than it sounds: the old order made a database problem look like a
*deploy* problem — nothing listened, so the platform showed a successful build
followed by a deploy spinning indefinitely, and the log stayed silent. There
was nothing to read and nothing to click.

Now the deployment always comes up and accounts for itself:

- `GET /api/status` reports `databaseReady`, `databaseBackend`, `databaseTarget`
  (host, database and user — never the password) and `databaseError`.
- Every `/api/*` route returns **503 with the reason** until the schema is
  ready, so a half-built database is never served from.
- The page itself still loads, because a blank 503 tells nobody anything.
- The process **stays up** on failure rather than exiting. It still never falls
  back to ephemeral storage: a broken deployment that says so beats a working
  one that quietly loses data.

Connections are bounded — 10s per attempt, five attempts with backoff, and a
120s ceiling on startup overall — because `pg` has no connect timeout by
default, and a host that silently drops packets (wrong region, firewalled
external URL, deleted database) would otherwise hang forever.

**And it keeps trying.** Provisioning a managed database can take minutes,
which is longer than any startup ladder should wait, so exhausting the ladder
schedules another attempt (`DATABASE_RECHECK_MS`, default 30s) instead of
giving up for good. The app repairs itself the moment the database appears —
no redeploy for a problem that fixed itself.

On the free plan, instances still sleep after ~15 minutes idle (the first request back is slow), but
data survives that, along with restarts and redeploys.

Two things to diary about free Postgres on Render. It **expires 30 days after creation**, then gives
a **14-day grace period** to upgrade before Render deletes it and everything in it — about 44 days
end to end, with email warnings at both points. More importantly, free Postgres has **no backups of
any kind**, so move to a paid instance before this holds a real principal's calendar and contacts,
whatever the expiry clock says.

## Naming

The product calls itself **Kairos by Exousia**. Two forms, from one place —
`server/lib/brand.js` and `client/src/lib/brand.js`:

- **full** where it introduces itself: browser tab, wordmark, signup and login
  headings, booking pages, outbound email.
- **short** in running prose, where the full name would read as shouting —
  *"your Kairos account"*, not *"your Kairos by Exousia account"*.

`BRAND_NAME`, `BRAND_SHORT_NAME` and `BRAND_COMPANY` override the server's
copy without a code change.

## Handles

The `slug` column, promoted from "the last part of your booking URL" to what a
person is called here. Same value, different standing: a principal is `@ada`,
and their booking page happens to live at `/book/ada`.

Deliberately **not** a directory. A handle resolves only inside a relationship
that already exists — someone you support, someone who supports you, someone
you share a space with. Look up a stranger's handle and you get nothing back,
indistinguishable from a typo, so it can never be used to test whether a given
person is on Kairos. Establishing a *new* relationship still goes through an
email invitation, because that is an act and should feel like one.

`lib/handles.js` owns the reserved list — the app's own paths, the names worth
impersonating, the ones we may want later.

## Custody: essentials, encryption, and two-factor

The things people are asked for and cannot recall — passport numbers, seat
preferences, loyalty numbers, policy numbers, sizes. Not a document store: a
set of **answers to questions other people ask**, which is why the unit is a
field with a copy button rather than a folder with a file in it.

Holding identity documents makes this a custodian, so the machinery around it
matters more than the feature:

- **Two-factor authentication** (`lib/totp.js`, RFC 6238, no dependency) and
  **login rate limiting** (`lib/rateLimit.js`). Everything else is downstream
  of an attacker simply signing in, so these come first.
- **Encryption at rest** (`lib/secretBox.js`, AES-256-GCM) with the key in
  `ENCRYPTION_KEY`, outside the database. **Lose the key and the data is
  gone** — there is no recovery path, by design, because a recovery path is
  just a second key kept worse.
- **Masked by default.** A sensitive value goes out as `•••• 4821`. Seeing it
  is an action: it costs a password, it is rate limited, and it is logged.
- **An access log the principal reads.** *"Your Chief of Staff viewed your
  passport on 3 August."* A trust feature more than a compliance one.
- **Sensitivity, not a boolean.** `lib/essentials.js` marks each category, and
  a `delegate` engaged for scheduling sees dietary requirements and never an
  identity document. Withheld fields are **absent** from the response rather
  than refused — same 404-not-403 reasoning as spaces.
- **`verified_at`.** Data entered once and never rechecked looks authoritative
  while quietly going out of date; the number may be from the previous
  passport. An assistant confirms *"I held the document"*, with the date.

What it is for, once it exists: **expiry warnings** on Today (a passport under
six months' validity turns someone away at check-in), a **trip-ready check**
against a travel date, and a **travel block** — one copyable paste of
everything an airline asks for, which is where the seconds are actually saved.

With no `ENCRYPTION_KEY` set, the identity categories are **marked "not
available yet" and cannot be selected at all**, and the screen says plainly
why. Not merely refused on save: that is a rejection after the work is done,
and after a passport number has been typed into a box that was never going to
keep it. Everything else works normally — preferences, allergies, loyalty
numbers, sizes, policy numbers.

Set the key later and the categories unlock on the next load. Nothing to
migrate, because nothing sensitive was ever stored.

Not built, deliberately: **file uploads**. That needs a storage answer, a
retention policy, and a considered response to "what happens when this leaks".
The screen says so in as many words — someone holding a passport expects to be
able to photograph it, and finding out only after hunting for the button is
worse than being told.

## Two roles, two dashboards

A principal and an assistant are asking different questions, so they land on
different screens rather than one screen with a switcher on it.

- **Principal → `/today`.** Their day, and what needs a decision from them.
- **Assistant → `/workspace`.** Every principal they run, in one view, without
  having to pick one before the app will say anything. The switcher becomes a
  way *into* a principal rather than a prerequisite for seeing anything.

### Itinerary: draft → proposed → confirmed

The reason this is a state machine rather than a boolean is that each
transition has exactly one party entitled to make it.

| status | who sees it | how it moves |
| --- | --- | --- |
| `draft` | the assistant only | assistant publishes, or asks |
| `proposed` | both, marked pending, listed as a request | the principal decides |
| `confirmed` | both — it is the day | — |

A principal's day sheet has one job: be true. A half-arranged flight does not
belong on it, so drafts are **absent** from the principal's view, not dimmed —
and a principal addressing a draft by id gets a 404, not a 403, because
"forbidden" would confirm that something is there.

Two ways out of a draft, both deliberate. **Publish** puts it straight on the
principal's day: an assistant who has finished arranging something is
reporting a fact, not asking permission. **Ask them** sends it as a request
with a note, and it shows up in the principal's *what needs you*. Declining
returns it to the assistant's drafts with the reason attached rather than
deleting it — the work of assembling it was real, and "not this time" usually
means "come back with a different flight".

### Titles

`pa`, `ea`, `chief_of_staff` and `delegate` live in `server/lib/roles.js`, and
the invite form fetches them rather than hard-coding a list. The first three
are the same access — they are titles, not tiers, and a Chief of Staff is not
a senior PA. Only `delegate` is genuinely narrower (scheduling only). An
invitation with no role stated adopts whatever the invitee called themselves
at signup, so nobody gets appointed under the wrong title.

### Closing an account

`server/lib/accountDeletion.js`. Available to anyone — it is their account —
and confirmed with a password rather than a checkbox, since a session left
open on a desk should not be enough for the one irreversible action here.

The part that matters: **an assistant's account does not take their
principals' data with it.** Deleting naively by `created_by` would empty a
principal's calendar the day their PA leaves. Confirmed items, briefs and
instructions made *for* someone else are reassigned to that person; only
unfinished drafts — which the principal has never seen and which mean nothing
without their author — go. The confirmation screen shows real counts for this
account, including how many items stay behind, so the decision is informed
rather than a leap.

Revoking an assistant's access stays the principal's alone.

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

## Today and the Itinerary

The two screens the job actually runs on.

### One navigation

Kairos had grown to roughly eighteen screens reached through per-page topbar links that differed on
every page — which is how a tool for busy people becomes work in itself. `components/AppShell.jsx`
is now the only navigation, used by **every** signed-in screen: the same rail everywhere, one active state, and the **principal
switcher in a fixed place** so "who am I doing this for" is never a guess. It persists across pages,
collapses behind a toggle on small screens, and carries a live badge for waiting approvals. Tabs
inside Dashboard and PA Home moved into the URL (`/dashboard?tab=settings`), so the nav can link
straight to a view and any view can be bookmarked or sent to someone.

**Signing out** lives in the account menu at the top right, next to the signed-in name — where
people look for it, and where it stays reachable at phone width. It previously sat at the foot of
the sidebar, which is both the last place anyone checks and, on mobile, hidden behind the menu
toggle. The menu closes on Escape or an outside click, and also offers Settings.

### Today

The landing screen for everyone, principal or assistant. One request (`GET /api/today/:ownerId`)
assembles it server-side rather than making the client run five round-trips for a screen whose whole
job is answering *what needs me right now*:

- **The day** — itinerary and confirmed bookings merged into one ordered stream, with the next item
  called out and how long until it starts.
- **Needs you** — bookings held for approval, records awaiting your acknowledgement, overdue tasks,
  and blocked stages, each actionable in place. Approving a booking from here is one click.
- **Worth remembering** — birthdays and anniversaries inside a week, from Contact Intelligence.

### Itinerary

A booking is something *someone else* asked for. An itinerary item is everything else that fills a
day — the flight, the car, the hotel, the dinner — and this is what a PA for a busy principal
actually manages.

- **Travel is timezone-aware by construction.** A leg carries a departure zone *and* an arrival
  zone, so a flight leaving Lagos at 22:40 shows "arrives 05:15 London" rather than making anyone
  do the arithmetic at 3am. Instants stay UTC; the zones say how to render each end.
- **Overnight legs work**, because a red-eye is the most ordinary shape of travel here: an end time
  at or before the start means the next morning, and the day sheet says "arrives next day".
- **Bookings appear in the same stream**, so there is never a second list to check. Pull one onto
  the itinerary (`POST /itinerary/:ownerId/items/from-booking/:bookingId`) to hang the car, the room
  number, or the pre-read off it — and it stops appearing twice.
- **Only travel asks travel questions.** The arrival-timezone field appears for flights, trains, and
  cars, and stays out of the way for a dinner.
- **Print a day sheet** — a stylesheet strips the navigation and controls so a clean page can be
  handed to the principal.

Access reuses the existing PA model exactly: whoever can act for a principal can run their day.

## The direct line

Most of what passes between a principal and the people running their diary is
one line long — *"car's outside"*, *"he's running twenty minutes late"*, *"can
you confirm Thursday"*. Spaces and threads could already carry it, and a
principal *could* create a space and invite their assistants into it. Nobody
does: that message is worth thirty seconds, not a setup flow, so it goes to
WhatsApp and out of the record entirely.

So every principal has exactly one **direct line** (`lib/directLine.js`),
created the moment they have somebody to talk to and surfaced one tap from
Today and from each principal card on an assistant's Workspace.

- **One room, not a DM per pair.** Two assistants covering the same principal
  need to see each other's traffic, not run parallel private conversations
  about the same diary.
- **Nothing to set up, and nothing when it would be empty.** It appears on the
  first accepted invitation; a principal working alone doesn't get an unused
  chat cluttering their Spaces list.
- **Membership mirrors the team, in both directions.** Accepting an invitation
  puts you in it; being revoked takes you out of it in the same request. A
  revoked assistant keeping a live line into the principal's team would be a
  quiet and serious leak. Because it is a mirror rather than a second list,
  adding or removing someone by hand is **refused with an explanation** instead
  of accepted and silently undone at the next invite.
- **An ordinary space and an ordinary thread**, marked `spaces.kind = 'direct'`.
  Notes, records, acknowledgement and task-from-message all work in it for
  free — so *"confirm Thursday"* can be promoted into a record on the spot.

The badge counts messages from other people since you last said something.
Without a read-receipt table that is a decent proxy for unread, and it is the
question actually being asked at a glance: *has anything happened that I have
not answered.*

## Connections — peers across principals

Two assistants running two different executives, trying to get those two
executives in a room. It is the most common conversation in the job, and the
app had nowhere to hold it: they share no principal, no space and no
membership, so nothing in the model connected them at all. It went to
WhatsApp, and the confirmation went with it.

- **Reached by an exact handle.** There is no search and no directory, and
  there won't be one: a list of who is on Kairos, and who they run, is itself
  the sensitive thing. You get a handle the way you always did — from a
  signature, or from them.
- **A request against a handle that does not exist is answered exactly like
  one that does** (`202`, "if that handle belongs to someone, they will see
  it"), and the endpoint is rate limited per account and per address. The
  honest-sounding "no such user" *is* the enumeration attack. The three cases
  where the caller already knows the person exists — yourself, already
  connected, already asked — answer plainly, because precision leaks nothing
  there and silence would just be confusing.
- **A connection is not a delegation.** It gives neither side any reach into
  the other's principal, calendar, contacts or team. Its own table, so no
  query in the app can mistake one for the other; the tests assert it in both
  directions.
- **The line is an ordinary thread**, so a confirmation can be promoted to a
  record on the spot. That is the difference between this and a chat app: "yes,
  Thursday 3pm at your offices" stops living in someone's phone.
- **Accepting makes the handle resolve.** It is the only route to a handle
  meaning anything outside your own principal's orbit, and it took both people
  agreeing to it.
- Either side can end it, and the room closes for both.

## The household

A driver, a cook, a housekeeper, a nanny — the people a principal or their PA
needs to tell something, where the question that matters is *did they get it*.

**They are not on `memberships`, and that is the entire security design.**
`requirePaAccess` grants on any active membership whatever the role, and five
other queries do the same. A household role added to that table would have
handed a cook the approval queue, contacts, briefs and the ordinary tier of the
essentials vault at six call sites at once — and none of those call sites would
have looked wrong in review. A separate table means no existing query can
include them by accident. Structural, like private spaces, rather than a flag
somebody could flip later without noticing what it touched.

- **Their whole app is one screen**: what they have been asked to do, a "Got
  it" button, and a line to reply on. The tests walk every principal-scoped
  endpoint and assert 403/404 on each.
- **`job_title` is free text and carries no access at all.** A driver and a
  chef see exactly the same thing: what was addressed to them. One staff
  member cannot open another's instruction.
- **Instructions, not tasks or messages** — both of those live in spaces, and
  using either would have meant giving household staff space membership, which
  is where everything else in the app lives.
- **Acknowledgement is the feature.** An unconfirmed instruction appears in the
  principal's *Needs you*, because a word to the driver that was never read is
  silent until it is too late.
- **Sent by email as well as shown in the app.** Somebody driving a car is not
  refreshing a dashboard, and an instruction that only exists on a screen they
  are not looking at has not been given.
- **Who may do what**: the principal and their full-access assistants can
  instruct; only the principal hires and dismisses; a `delegate` reaches none
  of it, because that remit is the diary and the household is not the diary.
- **Dismissal ends access, not the record.** What was asked and whether it was
  confirmed is exactly what you want when a question comes up later.
- The invitation page says the shape of it **before** they accept, not in terms
  afterwards.

## Running late — the day is a chain

The most common thing that happens to a principal's day, and for a long time
the app had no answer for it. Moving an item moved one row: the meeting it now
sat on top of, the driver waiting at the old time, and the flight that would be
missed were all somebody else's problem. The person this is built for would
have found out by being late.

A delay is now computed against the whole rest of the day (`lib/cascade.js`)
and **shown before it is applied**. Two rules carry most of the weight:

- **A gap absorbs.** If the next thing doesn't start for another hour, a
  twenty-minute overrun changes nothing and the cascade stops there. This is
  what a good assistant does in their head, and a system that shunts the whole
  afternoon regardless is worse than useless — it cries wolf, and then nobody
  reads it.
- **An anchor does not move.** A flight departs when it departs. If the day
  would overrun one, that's a conflict stated in plain words — *"you would
  reach this 30 min after it leaves; it will not wait"* — never a time quietly
  rewritten. Applying over a conflict takes a second, explicit confirmation, so
  nobody moves a morning and discovers the flight afterwards.

`travel_minutes` is what keeps the arithmetic honest: without it the engine
produces a schedule that is valid on paper and impossible in a car.

When it's applied: shifted legs with a driver generate a **fresh instruction**
("car at 11:15, not 11:00") that goes back to unconfirmed, because a changed
time is a new thing to be confirmed and the record should show both. A note
lands in the direct line naming what moved and what couldn't. External
attendees are **flagged, never messaged automatically** — how you word running
late is a judgement call, not a template.

## Trips — a flight is never just a flight

It's a check-out, a car, the flight, and something at the other end. Those get
forgotten because entering them is four more forms at the moment you've already
finished the interesting part. So one form builds the chain:

    10:30  Check out — The Connaught
    11:00  Car to Heathrow T5          → driver told, must confirm
    14:00  BA 083 to Lagos             ← anchor
    20:45  Car from Lagos              → bags and immigration, not wheels-down

The flight is marked as the anchor automatically. Anyone assigned a driving leg
is sent it immediately and has to confirm — rather than in a follow-up step,
which is the step that actually gets missed.

## Notices — one direction

The useful half of "a community for assistants", without the half that would
hurt. A forum where PAs discuss their principals, from accounts traceable to
named executives, runs against everything else in this app — and no permission
check catches that kind of leak, because the person posting does not
experience it as one. A broadcast channel keeps the information and the
notices, carries no moderation surface, and cannot be turned into a directory
of who is here.

- **Who may publish is read from `ANNOUNCEMENT_AUTHORS` in the environment**,
  not from a column. There is deliberately no request that can add somebody to
  it and nothing in the database to flip — the same reasoning as
  `ENCRYPTION_KEY` living outside the data it protects. Unset means nobody can
  publish, and the screen says so **to the people who could act on it**, and to
  nobody else.
- **Aimed rather than blasted.** `everyone`, `assistants`, `principals`, or
  `household`. An assistants-only notice is the thing a PA actually wanted out
  of a community, and a principal does not need to read it — a channel nobody
  can mute is only worth reading if what arrives was meant for the reader.
- **Nobody may reply, and there is no endpoint to.** That is the property that
  makes this safe to ship.
- Drafts, withdraw, and re-publish, because a notice that went out wrong is
  worth being able to correct. Authors see how many people have read each one.
- Opening the page marks it read; asking someone to tick off a notice they
  have just read is make-work.
- A request from an account that may not publish returns **404, not 403** —
  the existence of a broadcast channel and who writes to it is not something
  an ordinary account needs confirmed.

Not sent by email, deliberately: notices are worth a badge, not an inbox.

## Email — recorded either way

Every message is written to the `emails` table before any provider is called,
so the in-app Outbox is a complete record whether or not delivery is
configured. With `RESEND_API_KEY` set, each one also carries what actually
happened:

- **Delivered** — the provider accepted it.
- **Not delivered** — it refused, and the Outbox shows its exact words.
- **Outbox only** — no provider configured; this is the only copy.

That middle state is the one worth having. `fetch` does not throw on a 4xx, so
a rejected message used to be recorded as sent, never arrive, and leave nothing
behind to explain it — and the commonest rejection by far is *"you can only
send testing emails to your own address"*, which is what Resend says until a
domain is verified. An invitation that silently goes nowhere is worse than one
that fails loudly: the person waiting for it has no idea they are waiting.

`EMAIL_FROM` sets the sender. Unset, it falls back to Resend's shared testing
address, which reaches only the account owner — enough to prove the wiring,
not enough to invite anyone. `RESEND_ENDPOINT` exists so the failure path can
be tested against a stand-in, since there is no other way to exercise "the
provider said no".

## What an assistant can and cannot do

Approving a Tier 3 booking while being unable to set the hours that produced the slot makes no
sense, so **availability and meeting types are delegated to every assistant by default** — that is
the job. A principal who treats their own hours as personal can revoke it **per assistant** from
Members, without disturbing anything else they do.

The line is drawn at scheduling versus identity:

| Delegated (default on) | Owner-only, always |
| --- | --- |
| Availability, meeting types | Profile, timezone, booking-link slug |
| Approvals, contacts, relationships | Members and delegates |
| Briefs, instructions, comms | Calendar-sync and WhatsApp integrations |
| Itinerary, Today, AI assist | |
| Spaces, projects, tasks | |

Both paths — a principal editing their own, an assistant editing a principal's — run the *same
code*: `lib/scheduling.js` holds the operations, and `routes/availability.js` /
`routes/meetingTypes.js` call it with `req.user.id` while `routes/pa.js` calls it with
`req.principal.id` behind `requireSchedulingAccess`. The validation and error strings are therefore
identical by construction rather than by discipline.

Assistants get a **Scheduling** entry in the nav that disappears when access is revoked, and the API
refuses it independently — the UI hides the door, the server locks it.

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

The Postgres port is done, so this is now a connection-string change rather than a rewrite: point
`DATABASE_URL` at a Supabase project and the app runs against it unmodified. What remains
Supabase-specific is enabling Row Level Security per the blueprint's security architecture
(Section 5) — the application already enforces every isolation rule in `lib/spaceAccess.js` and
`lib/paAccess.js`, but RLS would enforce them a second time at the database, so a bug in a route
could not leak across a boundary.
