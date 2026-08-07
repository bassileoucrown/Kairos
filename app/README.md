# Kairos App — Core Scheduling Loop

A real, working slice of the Kairos product: sign up, set your weekly availability, create a
meeting type, and let someone actually book a slot with you — with correct timezone handling
throughout. This is the first build against the "Phase 1" scope in the master blueprint: auth,
onboarding, availability, and public booking. It does not yet include multi-group management,
members/delegates, in-app video, or the PA layer — those come later.

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

## What's actually implemented

- **Auth** — email/password signup and login, scrypt password hashing, httpOnly session cookies.
  No email delivery is configured, so accounts are marked verified immediately on signup — replace
  this with real verification before any real user data touches it.
- **Onboarding** — profile (name, booking-link slug, timezone) → weekly availability → first
  meeting type → dashboard.
- **Availability** — a weekly recurring schedule (day of week + start/end time, stored in the
  owner's own timezone).
- **Meeting types** — name, duration, format (video/phone/in-person), buffers, active/inactive
  toggle.
- **Public booking** — `/book/:slug` lists a person's active meeting types; `/book/:slug/:meetingSlug`
  computes real open slots for the next 14 days from the availability rules minus existing
  bookings, lets the visitor pick their own timezone, and displays every slot converted to it.
  Booking is re-validated against the live schedule at submit time to close the race between
  viewing slots and confirming one (no double-booking).
- **Booker-side reschedule/cancel** — every confirmed booking gets a private manage link
  (`/book/manage/:id`, the booking's own UUID doubling as its access token) where the booker can
  move it to a different open slot or cancel it outright, no owner involvement required. This
  closes the Phase 1 blocker in Section 3.6 (Gap 1) — an ungoverned reschedule path was a hole in
  the product's own thesis. Reschedule re-validates the target slot live and excludes the
  booking's own current slot from the conflict check so moving it doesn't collide with itself.
- **Dashboard** — upcoming/past bookings with owner-side cancel, plus in-place editors for
  availability and meeting types (same underlying API the onboarding flow uses).

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

Per the blueprint's own phasing (Section 7), these are out of scope for this pass, not oversights:
multi-group management, members/delegates, in-app video (Jitsi), calendar sync,
WhatsApp/email notifications, the PA layer, and anything past Phase 1. (Tiered PA-routed
reschedule/cancellation for Tier 3/4 bookings — as opposed to the Tier 1 self-serve flow
implemented here — waits on PA Home in Phase 2A, per the blueprint's own tier model.)

## Moving to Supabase

`app/server/lib/db.js` is the only file that knows about SQLite. The schema in `schema.sql` was
written to stay close to standard SQL (explicit foreign keys, ISO-8601 text timestamps, UUID text
ids) specifically so a Postgres/Supabase port is a matter of re-pointing this module at a Postgres
client and enabling Row Level Security per the blueprint's security architecture (Section 5) — not
a rewrite of the route or slot-computation logic, which talk to `db` through plain SQL calls.
