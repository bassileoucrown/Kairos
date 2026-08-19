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

- **Two-factor authentication** (`lib/totp.js`, RFC 6238, no dependency,
  checked against the specification's published test vectors) and **login rate
  limiting** (`lib/rateLimit.js`). Everything else is downstream of an attacker
  simply signing in, so these come first.

  **Where the code is demanded is a choice, and the default is the vault
  rather than the front door.** A code at sign-in protects everything but is
  paid on every login, and that friction is what makes people turn two-factor
  off — an account with it off protects nothing at all. Spending it on the
  vault puts the cost where the value is: a stranger with the password reaches
  a calendar, and still cannot read a passport number. A principal who wants it
  at both sets `scope` to `login_and_vault` on the Security screen, and moving
  it costs a step-up of its own, so somebody holding a live session cannot
  quietly weaken the front door.

  **Signing back in** asks for the code and gives you somewhere to type it —
  which sounds too obvious to state, and is stated because it was missing. The
  setup screen shipped working into a login screen that rendered email and
  password only and ignored the server's `needsCode` entirely, so turning
  two-factor on locked you out of your own account. The suite that was supposed
  to catch this checked the endpoint with `fetch` and never drove the page:
  testing the endpoint is not testing the door. `bsignin` now walks the whole
  return journey in a browser, including a recovery code for the phone in the
  river.

  The setup screen assumes no prior knowledge, because the first version
  assumed all of it: it printed a 32-character base32 secret under the words
  *"most apps scan a QR code"*, drew no QR code, named no app, and left the
  reader to discover that the six digits come from a program they had not
  installed — while the server had been sending an `otpauth://` URI the whole
  time that nothing used. It now names four authenticators by name, draws the
  QR code (encoded in the browser, so the secret reaches no third party), shows
  the key in groups of four for typing by hand, offers a one-tap `otpauth://`
  link that adds the account directly on a phone, says the number changes every
  30 seconds, and — for the failure that looks like a bug and isn't — says to
  check the phone's clock. The suite computes a real code from the secret the
  page displays and confirms with it, so "the screen works" means the loop
  closes rather than that the boxes rendered.
- **Encryption at rest** (`lib/secretBox.js`, AES-256-GCM) with the key in
  `ENCRYPTION_KEY`, outside the database. **Lose the key and the data is
  gone** — there is no recovery path, by design, because a recovery path is
  just a second key kept worse.
- **Masked by default.** A sensitive value goes out as `•••• 4821`. Seeing it
  is an action: it costs a **second factor**, it is rate limited, and it is
  logged.

  The second factor rather than the password, because the attacker this vault
  has to survive is the one who already knows the password — phished, reused,
  leaked. A gate made of the same password opens for them on the first try, so
  it defends against a borrowed laptop and against nothing else. Where
  two-factor is enrolled, revealing a passport or a BVN asks for the code from
  the phone; somebody who has taken the account still cannot read it. Where
  two-factor is not enrolled there is nothing else to ask for, so the password
  stands and the gate is never weaker than it was (`lib/stepUp.js`).

  One step-up covers five minutes of that browser's work
  (`STEP_UP_GRACE_MS`). Without it a Chief of Staff at a check-in desk reads a
  passport, then a visa, then a known-traveller number and types three codes
  from an app that rotates every thirty seconds — friction that heavy does not
  make people careful, it makes them turn two-factor off, which costs far more
  than it saves. Every reveal inside the window is still logged individually.
  A recovery code works here too, for the same reason it works at sign-in.
- **An access log the principal reads.** *"Your Chief of Staff viewed your
  passport on 3 August."* A trust feature more than a compliance one.
- **Sensitivity, not a boolean.** `lib/essentials.js` marks each category, and
  a `delegate` engaged for scheduling sees dietary requirements and never an
  identity document. Withheld fields are **absent** from the response rather
  than refused — same 404-not-403 reasoning as spaces.

  A field may override its category (`sensitivityOf`), and one group relies on
  it. **Identity and registration numbers** holds a BVN next to a TIN because
  that is where a person looks for both — but a BVN is a key to somebody's
  banking and a TIN is printed on every invoice the company issues. Marking the
  whole group sensitive would have been easier and would have taught assistants
  that the marking means nothing, so BVN, NIN and voter's card are sensitive
  while TIN and RC number are not.

  This matters most for **Nigeria, where the numbers are not interchangeable**:
  a bank wants the BVN, a telco wants the NIN, an invoice wants the TIN, and an
  assistant is asked for two of them in the same phone call. A single generic
  "National ID" field forced a choice between them. Health carries the same
  point — **genotype** (AA/AS/SS) is asked on essentially every Nigerian
  hospital admission form and is not derivable from blood type.
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

### Setting the key on a deployment already running without one

Additive, and proven so rather than assumed: nothing sensitive was ever
accepted without a key, so there is no plaintext waiting to be migrated and
nothing that now fails to decrypt. A suite runs one database through both
states and checks the seam from both sides — accounts still sign in, ordinary
details saved beforehand still read, messages and armed access codes are
untouched, and what was refused before (identity fields, two-factor, voice
notes) starts working on the next load.

**The app makes the key.** Sign in, go to **Dashboard → Security**, and while
no key is set the first card offers one: press *Generate a key* and 64 hex
characters appear, produced by the browser's own CSPRNG
(`components/EncryptionKeySetup.jsx`). Copy it, save it, and paste it into
Render as `ENCRYPTION_KEY` — the card lists the dashboard steps. The service
restarts on the same database and the card disappears.

This exists because the documented way to produce the key used to be a shell
command, which assumes a developer. The person standing up a deployment often
is not one, so the single most important security setting sat behind a tool
they did not have and stayed unset — the worst outcome available. A suite
checks the generated value is well-formed, differs every time, is what lands on
the clipboard, and — inspecting every request body the page sends — **never
reaches the server**. A key the server has seen is a key the server could keep.

For anyone who does have a terminal, this is the same thing:

```
openssl rand -hex 32
```

**Back the key up somewhere that is not this application, before anything is
stored under it.** A password manager, or written down and kept where the
company keeps things it cannot replace. Losing it destroys every identity
detail and every recording, permanently and by design. There is no rotation
path yet: changing the key later orphans everything encrypted under the old
one, so treat this value as permanent until one exists.

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
  Set `SENDGRID_API_KEY` or `RESEND_API_KEY` (and optionally `EMAIL_FROM`) to also deliver
  for real.
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

### Saying it instead of typing it

Both AI Assist boxes have a microphone (`components/Dictate.jsx`). Dictation
fills the same field the fingers would and the existing parser reads it
unchanged — which is why speaking to the assistant needed no new understanding
on the server, and why what it can and cannot do is exactly the same as before.
Speech is appended, so a second sentence extends the first and a correction
typed by hand is not wiped out by pressing the button again.

**Where the audio goes is the part that matters here.** This uses the browser's
own speech recognition. In Chrome and Edge that is *not* on-device: the audio
goes to the browser vendor's servers and comes back as text. Safari on current
Apple platforms recognises on-device. Firefox does not implement it at all. For
most products that is a footnote; for this one it is the whole question,
because the sentence being dictated names a principal, a counterparty and a
time. So:

- **Nothing listens until the microphone is pressed**, and it stops at the end
  of a sentence rather than holding an open mic in a shared office.
- **The screen says so before it is used** — in the browsers where it is true —
  and says to type it instead if the wording is sensitive.
- **It is offered on the assistant's instruction boxes and nowhere else.** The
  direct line already takes voice, encrypted at rest with a key only this
  server holds (`lib/voiceNotes.js`); routing that through a third party for a
  transcript would quietly undo the property that made it worth building.
- A browser with no speech support shows **no microphone at all**, rather than
  a button that does nothing.

`lib/speech.js` is written so the component does not know what is underneath
it, which is what makes the private path a swap rather than a rewrite:
transcription on our own server behind a provider key, or a small on-device
model. Neither is built — the honest reason is the same one as everywhere else
in this file, that it needs a credential nobody has configured yet.

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

## Deadlines arrive before they pass

"What needs you" on Today used to list a task only once it was already
**overdue** — so the first time a principal saw it, the deadline had gone and
the only available action was an apology. The vault had warned six months ahead
of a passport expiry since the beginning, on exactly the reasoning that
*"expired" is far too late to start worrying*; tasks were the one place that
rule was not applied.

They are now surfaced while there is still time to act, and how much time
depends on what missing it costs:

| Priority | Warning |
|---|---|
| High | 3 days |
| Normal | 24 hours |
| Low | 8 hours |

Priority is the proxy because it is already on the task, already set by whoever
assigned it — the person who knows whether this is a signature that has to
reach a registry or a call that takes five minutes. A single 24-hour window
treated those identically.

One definition of "close" (`dueBand` in `lib/reminders.js`) drives both the
screen and the reminder emails, so they can never disagree about what is
urgent. The card distinguishes the two states, because they call for different
things: *"due in 6 hours"* is a warning you can still act on, *"overdue since
Tuesday"* is a report of a failure. A task already listed in "what needs you"
is not repeated in the day's task list.

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

**Back** sits beside the title, and means the screen you were just on. The rail
says where everything *is*; it never said where you came *from* — so a PA who
opens an approval from Today, deals with it, and wants Today again has to work
out which of eighteen entries they started from, and gets it wrong, because the
answer depends on a route they took a minute ago and are no longer looking at.
The browser knows. This is the browser's own back, put where a thumb can reach
it, since at phone width there is no visible one.

It appears **only when there is somewhere inside Kairos to go back to**. Each
history entry carries an index; at index zero this is the first screen of the
session, and back would mean leaving the app — a button that signs you out of
your own tab is worse than no button. Reloading is deliberately not that case:
a refresh keeps the browser's history, the entries behind you really are still
there, and back stays.

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

### Voice notes

A principal in the back of a car will not type. So the direct line takes
recordings (`lib/voiceNotes.js`), captured with the browser's own
`MediaRecorder` — one button, a running clock, and a listen-back before
anything is sent, because the alternative to a preview is discovering you sent
forty seconds of road noise to your Chief of Staff.

Three things govern it, and each follows from a recording being *more*
sensitive than the typed message it replaces, not less. People speak more
freely than they type: a note that would have read *"push the 3pm"* arrives as
*"push the 3pm, I'm still with the lawyer and I don't want it discussed."*

- **It needs `ENCRYPTION_KEY` — the same key the vault needs.** Without one the
  microphone is not offered and the endpoint refuses, saying why. Holding a
  principal's voice in plaintext because a key was inconvenient to set is the
  one outcome worth refusing outright.
- **It expires.** Thirty days (`VOICE_RETENTION_DAYS`), swept on a timer, and
  treated as gone the moment it lapses whether or not the sweep has reached it
   — a deadline that depends on a timer having fired is not a deadline. The
  message stays; only the audio goes.
- **It is capped hard.** Two minutes, two megabytes. A direct line is for *"the
  car is downstairs"*, not for dictating a memo.

The audio is a row, not a file: Kairos has no object store, and a recording on
a container's disk is gone at the next restart — the same reason the app
refuses to call ephemeral storage durable. At roughly 90 KB a note there is
room for years of ordinary use before that trade needs revisiting.

A voice note is an **ordinary message that happens to carry a recording**, so
the direct line, the unanswered badge and task-from-message keep working
without knowing voice exists. Two consequences worth stating:

- Its body is empty until somebody writes down what was said, so Today
  describes it — *"Voice note · 0:12"* — rather than showing a blank line
  beside a name, which reads as a bug.
- It **cannot be promoted to a record.** A record is a frozen line of text that
  people acknowledge and later cite; a recording with no transcript would file
  an empty body and an acknowledgement of nothing. Refused with the remedy:
  write out what was said and file that.

One thing deliberately not used: the browser's built-in `SpeechRecognition`
would give free transcription with no key, but Chrome's implementation ships
the audio to Google's servers. For an app holding passport numbers that is the
wrong trade at any price.

**Body limits.** Every other endpoint is held to 100 KB of JSON, which is a
deliberate guard. A recording does not fit in that, and a parser mounted on the
route cannot help — the global one runs first and rejects the body before the
route's own limit ever sees it, which surfaced as a 500 on any note longer than
a few seconds. So the voice path skips the global parser and declares its own
4 MB ceiling, and an oversized body now answers 413 with something a person can
act on rather than *"something went wrong"*.

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

## Trips — a journey as an object

Before this, "the London trip" was a handful of itinerary items that happened
to sit near each other. Nothing could be asked of it. A `trips` row now carries
the destination, the dates, and — the load-bearing part — **the timezone the
principal is actually in while they are there**.

### The day is drawn where you are standing

`/api/today` computed the whole day in the timezone on the principal's profile,
always. A week in London was therefore rendered in Lagos time: the day began
and ended at the wrong moment, a 09:00 meeting showed as 08:00, and the delay
cascade reasoned about gaps against the wrong wall clock. The itinerary row
could always express a leg that crosses zones — `start_timezone` and
`end_timezone` have been there from the beginning — but nothing read them,
because nothing knew where the principal *was* on a given date.

Only a **confirmed** trip moves the clock. A draft is an assistant's working
copy and must not silently redraw somebody's week; a proposal is a question,
and answering it by shifting their day would be deciding it for them. The
response still reports `homeTimezone` alongside, so the screen can say *"you
are on London time"* rather than leaving a person to wonder why their day
starts at an odd hour. Confirming a trip is the principal's to do, for the same
reason.

### Away from home there is no household driver

An itinerary item could name exactly one person — `household_member_id`, the
driver or the cook. That is a *household* relation and by definition only
exists at home. Land in London and the arrival transfer had a person-shaped
hole, which the trip builder papered over with a title and nobody attached.

A leg now records **how it is arranged**: own driver, hired car, hotel
transfer, host is sending someone, or making their own way. The middle three
are refused without a name or a number, because a hired car with nobody to ring
is not an arrangement, it is a hope — and the moment it matters is a flight
landing ninety minutes late.

### Met by a phrase, not a name board

The ordinary way an executive is met is a stranger holding a placard with their
name on it. That board announces, to everyone standing in an arrivals hall,
that this named person has just landed and is about to get into a car. For a
principal in this market that is not an indignity, it is a targeting notice.

So neither side displays anything (`lib/pickup.js`). Both hold the same two
words, agreed in advance: the principal knows the car and the phrase, the
driver knows the flight and the phrase, and whoever speaks first the other
answers. No name is said aloud.

The driver gets a **card** — a link with no password on it, because they have
no Kairos account and never will. What protects it is what it does *not*
carry:

| On the card | Deliberately absent |
|---|---|
| Flight number, meeting point, time | The principal's surname |
| The phrase | Their phone number or email |
| A first name, to greet with | Where they go afterwards |
| A number to call if delayed | Anyone else travelling, anything from the vault |

The address is 24 random bytes, it stops working a day after the pickup, and
re-arming issues a fresh phrase *and* a fresh address — which is the correct
answer both to "the driver changed" and to "that link was forwarded". A wrong
address and an expired one answer identically. The suite checks all of this
from the wrong side: what a stranger holding the link actually gets.

### Finding the driver, rather than being found by him

The phrase solves half an arrivals hall. It works once two people are already
facing each other — and the half left open is the one the principal actually
experiences: they walk out of customs into forty strangers holding forty
boards, with nothing to look for. Somebody still has to close the distance, and
it was the principal, guessing.

So both screens show the same thing at the same second (`lib/pickupSignal.js`):
a colour and a shape. The driver holds his phone up, screen outward. The
principal is looking for **orange with a triangle**, not for their own name in
a stranger's hands. It is a name board with the name taken out, which is the
only part of a name board that was ever a problem.

- **It says nothing to the room.** A coloured square identifies nobody.
- **It rotates,** every minute, derived from the card's own address the way an
  authenticator code is derived from a secret. A photograph of the driver's
  screen is worthless before it can be forwarded and used.
- **It is sayable** — two plain words. On the phone, before either can see the
  other, the principal can ask what the driver is showing and get an answer
  that cannot be guessed from outside. The palette is small and plainly named
  for exactly this, and deliberately not enlarged for entropy it does not need:
  forty-eight combinations is a *finder*, and the phrase is still what proves
  anything.
- **Colour is never the only channel.** The shape carries the same information
  for a colour-blind principal, a screen at minimum brightness, and a hall lit
  amber by sodium lamps.
- **It closes.** The principal taps once; the driver's screen changes in his
  hand, untouched, and tells him to stay where he is. The signal then *freezes*
  — otherwise it would rotate while they are still walking over, and the thing
  they identified would stop being true halfway across the hall.

Both sides read the signal from the server, so neither phone's clock is trusted
and the two cannot drift apart; both also refetch at the instant the server
names as the change, rather than whenever their own polling happens to come
round. The driver's phone is never given the address the signal is derived
from, only this minute's answer, and the page holds a screen wake-lock where
the browser has one — a phone held out at arm's length goes to sleep in thirty
seconds otherwise.

**What this is not: a tracker.** Nothing here reports where anybody is. A live
position for a principal is the most dangerous row this database could hold,
and the feature does its whole job without one. Location sharing, if it is ever
built, would be one-way — the driver to the principal, never the reverse — and
retained not at all.

Re-arming clears any handshake with the phrase and the address, so a new driver
is never told he has already been recognised.

### Building one, from the screen that shows it

Everything above existed on the server from the moment trips were built, and
the Trips screen drew all of it faithfully — for journeys that could not be
created. **"The journey" was read-only.** The endpoint that fills it
(`POST /itinerary/:ownerId/trips`) had no button anywhere in the app, and a
single itinerary item added from the Itinerary screen was never attached to a
trip. So a trip was a name, two dates and an empty list, and every feature
underneath it was invisible — not missing, but never reaching the condition
that renders it.

Two ways in now, from the trip itself:

- **Add a flight** builds the whole chain in one form — the flight with its
  terminal, seat and reference; the car to the airport; the hotel check-out
  before it; the transfer at the far end; and the meeting phrase armed on
  arrival, with the driver's card address offered once, right there. Entering
  those five legs separately is five forms at the moment somebody has already
  finished the interesting part, which is how they end up not entered at all.
- **Add something else** puts one thing on the trip — a dinner, a hotel, a car
  with no flight attached.

The destination and both timezones are carried over from the trip rather than
retyped, and choosing "hired car" or "hotel transfer" asks for the company and
the number before it will save, since the server refuses those without one.

**Times are read in the zone the leg happens in.** A date input and a time
input give `2027-03-04` and `09:00` and no zone at all; `new Date(...)` then
reads them in the *browser's* zone, which is correct only when the person
filling the form is sitting in the same country as the event. This app exists
for the case where they are not. The Itinerary form had the same bug with a
comment above it already claiming otherwise — a PA in London entering a 09:00
Lagos departure stored 09:00 London, an hour out, with the form's own timezone
field sitting right beside it. `zonedToUtc` in `client/src/lib/timezones.js`
mirrors `server/lib/timezone.js` line for line so the two cannot drift, and the
suite fills the form from a browser deliberately set to Los Angeles so a
zone-of-the-browser bug cannot pass by coincidence.

### The rest of a trip

Travellers (a spouse's passport was already storable — `essentials` takes a
`subject_contact_id` — with nothing until now to tie them to a journey), local
contacts at the far end, terminal and seat on the flight, and **document
warnings checked against the trip's own dates rather than today**: a passport
with four months left is "in date" this morning and still turns somebody away
at check-in, because much of the world wants six months' validity beyond
arrival.

**Not built, and honestly so:** live flight status (the cascade engine is ready
to absorb a delay and has no source of truth telling it one happened) and
visa-requirement lookup by destination (needs a rules dataset; expiry-versus-
trip-dates is checked without one). Both are external-data problems rather than
missing code.

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
configured. With a provider set, each one also carries what actually happened:

- **Delivered** — the provider accepted it.
- **Not delivered** — it refused, and the Outbox shows its exact words.
- **Outbox only** — no provider configured; this is the only copy.

### Two providers, one path

**SendGrid** and **Resend** both work (`lib/emailProviders.js`). Set
`SENDGRID_API_KEY` or `RESEND_API_KEY` and the one whose key is present is
used; set `EMAIL_PROVIDER` only when both are and you need to say which. The
choice belongs to whoever stands the deployment up — they may already have an
account somewhere, or find one easier to verify a domain with — and it should
never mean editing code.

The differences are small and all in the places that break quietly. SendGrid
answers **202 with an empty body** where Resend answers 200 with JSON, wants
`from` as an **object** rather than a string, and reports refusals as
`{ errors: [{ message }] }` rather than `{ message }`. Reading the wrong one
turns a legible refusal — *"the from address does not match a verified Sender
Identity"* — into an empty string in the Outbox, which is precisely the failure
this section exists to prevent. Both shapes are exercised against a stand-in
provider, accepting and refusing.

A misconfigured `EMAIL_PROVIDER` fails **loudly**: status stops claiming
delivery is configured, and the message is recorded as failed with the reason,
rather than being quietly dropped.

**Verifying a sender is the real work**, and it is the same on either. Until a
domain is verified you can only send to your own address — which is not a
Kairos limitation and cannot be worked around in code.

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

### Picking one by knowing where you are going

The list was never missing. `Intl.supportedValuesOf('timeZone')` has had all
four hundred-odd zones the whole time, updated with the platform's own tzdata
rather than a copy of it going stale in this repo. What was wrong was every way
we *asked* for one.

An alphabetical dropdown of four hundred entries is a list you scroll, and
`Europe/London` sorts between Lisbon and Luxembourg — nowhere near where anybody
looks. The trip form was worse: free text, with `Europe/London` for a
placeholder, which is a spelling test. Type "London", or "GMT", or "UK" and the
server correctly refuses all three, having been given no way to say what the
right answer would have looked like.

`components/TimezonePicker.jsx` replaces all four (onboarding, the public
booking page, the itinerary's arrival zone, and the trip). Type where you are
going. The search covers the city, the region, the zone's own name, its current
offset, and a short alias list — so **Abuja finds Lagos time**, "Nigeria" and
"United Kingdom" both work, and nobody needs to know that their city's zone is
named after a different one. Every row shows the time it is there right now,
which is the fact the choice is usually really about.

Two details that are less obvious than they look:

- **Empty is not the alphabet.** Before anything is typed it offers the
  browser's detected zone first, then the places this market actually flies. An
  empty search box that answers with four hundred rows is the dropdown again.
- **Likely before obscure.** There is no population figure in the platform's
  list, so a naive prefix match falls back on alphabetical order — and
  alphabetically, "lon" is *Longyearbyen*, an Arctic settlement of about two
  thousand, before it is London. Matches are banded: the city typed in full,
  then city-prefix matches with somewhere likely first, then everything else.
  The proxy for "likely" is honest about what it is — the zones this product
  has had a reason to name are the zones its users mean.

The alias list is a search aid and no part of what gets stored; the value saved
is always the IANA name, which is what the server validates against `Intl` and
what every stored instant is resolved through.

## The concierge desk — declared, and shut

Built visibly and marked plainly, the same way calendar sync and WhatsApp are.
A principal deciding whether Kairos is the place their life goes should be able
to see the shape of what is coming, and should never be unable to tell which
parts work today. It has a nav entry carrying a **Soon** tag — so the rail says
it before you click, not after — and the screen leads with a banner saying it
is not open.

**What makes it unavailable is not a credential, and the copy says so.**
Calendar sync is gated on an OAuth client ID: somebody sets an environment
variable and it goes live. A concierge is people — a vetted fulfilment network
under contract, with agreed liability, who answer at 2am in the city the
principal is actually in. There is no key that turns that on. So the gate in
`lib/concierge.js` names a partner rather than a token, and **nothing anywhere
on the screen offers to "connect"**, because connecting is not the missing
thing. The suite asserts the absence of that word.

**There is no request box, deliberately.** The obvious placeholder is a form
that takes a request and returns a friendly message. That form would be a lie:
somebody would eventually type *"table for four at 8, my wife's birthday"* into
it, and nobody would be on the other end — a promise broken at the exact moment
they were relying on us. `POST /concierge/:ownerId/requests` exists so the shape
is settled and the refusal is a documented 501 with a reason rather than a 404
that looks like a bug, and it refuses.

**The one thing it accepts is real.** Marking a service as wanted writes a row
(`concierge_interest`), survives a reload, can be taken back, and the screen
states in plain words that it records a want for Exousia and does not raise a
request. Marking the same thing twice is not a second want.

The service list is named specifically — dining and venues, travel desk,
private aviation, events and access, gifting, household and staffing, medical,
security and logistics — rather than as "lifestyle management", because the
list *is* the product decision: a principal reading it can tell at a glance
whether it covers the things they currently ring three different people about.
Several of them lean on what Kairos already holds: gifting off the relationship
calendar that knows whose anniversary falls on Thursday, the travel desk acting
on a trip that is already an object.

Setting `CONCIERGE_PARTNER` flips `available` to true and the reason to null —
the switch is a real switch, not decoration, and the suite proves it by booting
a second server with the variable set. Requests still refuse, with a *different*
message, because a partner existing is not the same as the handoff being built.

## Plans, built before they are enforced

The commercial layer ships ahead of billing, switched off. `PLAN_ENFORCEMENT`
defaults to off; while it is off every check still runs, still resolves, and
**records what it would have refused** — and refuses nothing. Nothing becomes
unreachable by building this.

That is the reason to build it early rather than at launch. The price sheet is
a hypothesis: trips are on Plus and briefs on Executive because it reads well,
not because anybody has behaved that way. Some months of *who reached for what,
on the plan they would have been on* turns those boundaries into evidence
before a single customer is charged for a guess. `plan_signals` aggregates per
account and feature rather than appending per event, because the question is
"which boundaries are in the wrong place", not "what happened at 14:32".

**The word "tier" is deliberately not used.** It already means a meeting type's
access tier (1–4) and a contact's relationship tier. The commercial one is a
**plan**, so no conversation about any of the three is ambiguous.

Three rules in `lib/plans.js`, none of them negotiable:

- **Entitlement is never access control.** Whether a delegate may see a BVN is
  decided by `essentials.js` and a second factor. Whether the account is on Plus
  is decided by `plans.js`. If those merge, a billing bug becomes a data breach.
- **It fails open.** A null column, a half-run migration, an unknown plan name:
  the answer is *allow*. The failure mode of a strict check is a principal at an
  airport unable to read their own visa number because a default did not apply.
- **Only creation is gated; reading back is never gated.** A principal who drops
  from Plus to Standard keeps every trip and every document they put in, and
  simply cannot add more. Losing sight of your own passport number because a
  card expired is not a product behaviour, it is a hostage situation.

Existing accounts land on a **founding** plan — a real row in the ladder that
reaches Executive — so grandfathering is a fact in the data rather than a
promise in a spreadsheet. Signup writes the plan explicitly from `DEFAULT_PLAN`
rather than letting the column default catch it, which would have made the
setting inert and quietly put everybody on founding forever.

The gate reads the **principal's** plan, not the viewer's: an assistant with a
free account of their own is working inside their principal's entitlements, and
billing the wrong party for the right work would be a strange thing to build.

## Connectors — everything Kairos talks to, in one list

`lib/calendarSync.js` and `lib/whatsapp.js` were the same shape written twice.
`lib/connectors.js` is that shape named once, and the Settings screen is driven
by the registry rather than hand-written per provider.

**Two kinds, which behave nothing alike.** A **deployment** connector is
configured once by whoever runs Kairos and no principal ever sees a button —
flight data, object storage, transcription, SMS. An **account** connector is
connected by each principal to their own thing — their Google Calendar, their
WhatsApp number, their Zoom. Both `configured` and `connected` are reported,
never collapsed into one "available" flag, because they produce different
sentences: *not configured here* is our work outstanding, *ready to connect* is
theirs. A connector above the account's plan is shown rather than hidden —
somebody deciding whether to move up should see what moving up gets them.

Beyond the calendar and WhatsApp stubs that already existed, the registry names
the ones that would make the app materially better here:

- **Travel time with live traffic.** `travel_minutes` is typed by hand today. In
  Lagos the difference between 20 minutes and 90 is the entire schedule, and the
  delay cascade is already built to act on it.
- **Forward a confirmation.** Send an airline or hotel email to a trips address
  and the journey builds itself, instead of a flight being retyped from a PDF.
- **Contacts.** The four thousand people already in a phone, so the relationship
  calendar knows whose birthday is Thursday without anybody typing it.
- **A calendar subscription link.** Read-only, no OAuth, works in Apple Calendar
  and everything else. Needs no credential at all, so it is configured by
  definition rather than given an invented barrier.
- **Send from your own address.** An invitation from `office@theirbank.com`
  rather than `noreply@` is the difference between a board member replying and
  a board member ignoring it.
- **Ride-hailing**, for when the arrangement is "making their own way", and
  **SMS**, for the driver who will never open an app.

**Two deliberate absences.** Paystack and Flutterwave are not connectors —
billing has no per-account state and putting it beside Google Calendar would
suggest a principal could switch their own subscription off. And **identity
verification** (BVN or NIN checks through VerifyMe, Smile ID and the like) is a
judgement rather than an oversight: it would make the vault more useful, and it
would mean sending a principal's BVN to a third party, which is the opposite of
what the vault promises. If it is ever added it belongs behind explicit
per-document consent, never as a background check, and it is not being slipped
into a registry of conveniences.

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
