-- Kairos MVP schema (SQLite via node:sqlite).
-- Written to stay close to standard SQL so a later move to Postgres/Supabase
-- is a port, not a rewrite: TEXT ids (uuid), ISO-8601 TEXT timestamps,
-- explicit foreign keys, no SQLite-only types.

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  timezone        TEXT NOT NULL DEFAULT 'UTC',
  email_verified  INTEGER NOT NULL DEFAULT 0,
  onboarding_step TEXT NOT NULL DEFAULT 'profile',
  -- Self-declared at signup: principal | pa | ea | chief_of_staff. Assistant
  -- categories all get identical PA Home capabilities once someone invites
  -- them (the blueprint's Section 2.2 treats PA/EA/Chief of Staff as one
  -- functional role) — this only drives which onboarding steps and which
  -- dashboard they land on by default, not what they're permitted to do.
  account_category TEXT NOT NULL DEFAULT 'principal',
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  id         TEXT PRIMARY KEY, -- the reset token itself, random
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

CREATE TABLE IF NOT EXISTS meeting_types (
  id                     TEXT PRIMARY KEY,
  owner_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  slug                   TEXT NOT NULL,
  duration_minutes       INTEGER NOT NULL,
  description            TEXT NOT NULL DEFAULT '',
  location_type          TEXT NOT NULL DEFAULT 'video',
  buffer_before_minutes  INTEGER NOT NULL DEFAULT 0,
  buffer_after_minutes   INTEGER NOT NULL DEFAULT 0,
  -- 1=Public, 2=Standard: auto-confirmed. 3=Priority, 4=Inner Circle: held as
  -- 'pending' until a PA approves — the 4-tier access control from the
  -- blueprint's positioning (Section 1.1): a stranger and a board member are
  -- never routed the same way.
  access_tier            INTEGER NOT NULL DEFAULT 1,
  color                  TEXT NOT NULL DEFAULT '#3E6357',
  is_active              INTEGER NOT NULL DEFAULT 1,
  created_at             TEXT NOT NULL,
  UNIQUE(owner_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_meeting_types_owner ON meeting_types(owner_id);

CREATE TABLE IF NOT EXISTS availability_rules (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL, -- 0=Sunday .. 6=Saturday
  start_time TEXT NOT NULL,     -- 'HH:MM', 24h, in owner's timezone
  end_time   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_availability_owner ON availability_rules(owner_id);

CREATE TABLE IF NOT EXISTS bookings (
  id               TEXT PRIMARY KEY,
  meeting_type_id  TEXT NOT NULL REFERENCES meeting_types(id) ON DELETE CASCADE,
  owner_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booker_name      TEXT NOT NULL,
  booker_email     TEXT NOT NULL,
  booker_timezone  TEXT NOT NULL,
  start_at         TEXT NOT NULL, -- ISO-8601 UTC
  end_at           TEXT NOT NULL, -- ISO-8601 UTC
  -- pending: Tier 3/4, awaiting PA approval (still holds the slot).
  -- confirmed: on the calendar. cancelled: freed by booker or owner.
  -- declined: PA rejected a pending request; slot is freed.
  status           TEXT NOT NULL DEFAULT 'confirmed',
  video_room       TEXT, -- Jitsi room name, set for video-format meeting types
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookings_owner_time ON bookings(owner_id, start_at);

-- Notes on an appointment, in two registers.
--
-- THE MANAGE LINK IS A BEARER TOKEN. /book/manage/<id> asks for no password;
-- holding the URL is what makes you the booker. That is fine for what it was
-- built for — moving or cancelling your own meeting — and it decides
-- everything about notes: anything a booker can read is readable by anyone
-- they forward the link to, deliberately or not.
--
-- So a note is one of two things and never both:
--
--   office  — the office's own preparation. What the principal needs before
--             they walk in, which car, what was agreed internally. The booker
--             never sees it and no endpoint they can reach returns it.
--   shared  — said TO the booker. Directions, a follow-up after the meeting,
--             their reply. Written knowing a stranger may read it.
--
-- Kept as one table with a column rather than two tables, because the office
-- reads them together as one conversation about one appointment, and two
-- tables would mean two queries and a merge that could drift out of order.
CREATE TABLE IF NOT EXISTS booking_notes (
  id           TEXT PRIMARY KEY,
  booking_id   TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- office | shared
  visibility   TEXT NOT NULL DEFAULT 'office',
  -- Who wrote it. author_user_id for anyone in the office; NULL when the
  -- booker wrote it, since they have no account and are identified by the
  -- booking itself.
  author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_booking_notes ON booking_notes(booking_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bookings_meeting_type ON bookings(meeting_type_id);

-- ============================================================
-- PA Operating Layer + supporting infrastructure (Phase 2A)
-- ============================================================

-- Grants a user (member_user_id) PA/delegate access to a principal's
-- (owner_id) account. Invites are created before the invitee has an
-- account (member_user_id NULL, status 'invited') and linked once they
-- accept via invite_token.
CREATE TABLE IF NOT EXISTS memberships (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_user_id  TEXT REFERENCES users(id) ON DELETE CASCADE,
  invited_email   TEXT NOT NULL,
  -- pa | ea | chief_of_staff | delegate. The first three are the same access;
  -- they are titles, not a hierarchy, and a Chief of Staff is not a senior PA.
  -- Signup asks people which they are, so the invite has to be able to say it
  -- back — being appointed under the wrong title is a small insult that lands
  -- every time they open the app. `delegate` is the genuinely narrower one:
  -- scheduling only.
  role            TEXT NOT NULL DEFAULT 'pa',
  status          TEXT NOT NULL DEFAULT 'invited', -- invited | active | revoked
  -- Whether this assistant may set the principal's bookable hours and meeting
  -- types. On by default for every assistant role, because deciding who can
  -- reach the principal and when is the most PA-shaped job in the product —
  -- but a principal who considers their own hours personal can revoke it per
  -- assistant. Identity and access (profile, members, integrations) stay
  -- owner-only regardless.
  can_manage_scheduling INTEGER NOT NULL DEFAULT 1,
  invite_token    TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memberships_owner ON memberships(owner_id);
CREATE INDEX IF NOT EXISTS idx_memberships_member ON memberships(member_user_id);

-- Contact Intelligence: PA-maintained notes layered on top of what's
-- derivable from booking history (meeting count, last seen) at query time.
CREATE TABLE IF NOT EXISTS contacts (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email             TEXT NOT NULL,
  name              TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  relationship_tier TEXT NOT NULL DEFAULT 'professional', -- inner_circle | close | professional
  birthday          TEXT, -- 'MM-DD', year optional and not stored (a birthday recurs every year)
  anniversary       TEXT, -- 'MM-DD'
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE(owner_id, email)
);
CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id);

-- Brief Builder: one structured brief per booking, seven sections stored as
-- JSON (name, why, background, talking_points, desired_outcome, logistics,
-- sensitive_notes) rather than seven columns, since the set is edited as a
-- whole from one form.
CREATE TABLE IF NOT EXISTS briefs (
  id           TEXT PRIMARY KEY,
  booking_id   TEXT NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sections     TEXT NOT NULL DEFAULT '{}', -- JSON
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_briefs_owner ON briefs(owner_id);

-- Instructions Vault: free-text instructions a PA logs for the principal.
-- Voice capture is deferred (needs a transcription API key) — text only.
CREATE TABLE IF NOT EXISTS instructions (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by    TEXT NOT NULL REFERENCES users(id),
  text          TEXT NOT NULL,
  priority      TEXT NOT NULL DEFAULT 'normal', -- normal | urgent
  status        TEXT NOT NULL DEFAULT 'open',   -- open | done
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_instructions_owner ON instructions(owner_id);

-- Every email the system sends — transactional (confirmations, invites) and
-- PA-composed (Communications Engine) alike — so there's one outbox to look
-- at in dev without a real provider wired up.
CREATE TABLE IF NOT EXISTS emails (
  id               TEXT PRIMARY KEY,
  owner_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
  sent_by_user_id  TEXT REFERENCES users(id), -- NULL for system-generated
  to_email         TEXT NOT NULL,
  subject          TEXT NOT NULL,
  body             TEXT NOT NULL,
  category         TEXT NOT NULL DEFAULT 'transactional', -- transactional | invite | comms
  related_booking_id TEXT REFERENCES bookings(id),
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emails_owner ON emails(owner_id);

-- ============================================================
-- Itinerary — the principal's actual day, not just their bookings
-- ============================================================
--
-- A booking is something someone else asked for. An itinerary item is
-- everything else that fills a day: the flight, the car, the hotel, the
-- dinner, the twenty minutes of travel between two of them. A PA managing a
-- principal is managing this, and it has never lived in a calendar app well
-- because travel crosses timezones.
--
-- Hence start_timezone/end_timezone: a flight leaves Lagos at 22:40 WAT and
-- lands in London at 05:15 BST, and both of those are the truth. Instants are
-- still stored in UTC; the zones say how to render each end.
CREATE TABLE IF NOT EXISTS itinerary_items (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by     TEXT NOT NULL REFERENCES users(id),
  kind           TEXT NOT NULL DEFAULT 'meeting',
    -- flight | train | car | hotel | meeting | meal | personal | call | note
  title          TEXT NOT NULL,
  start_at       TEXT NOT NULL,  -- ISO-8601 UTC
  end_at         TEXT,           -- ISO-8601 UTC
  start_timezone TEXT,           -- departure zone; falls back to the owner's
  end_timezone   TEXT,           -- arrival zone, for legs that cross zones
  location       TEXT NOT NULL DEFAULT '',
  destination    TEXT NOT NULL DEFAULT '',  -- the other end of a travel leg
  reference      TEXT NOT NULL DEFAULT '',  -- PNR, confirmation, seat, room
  notes          TEXT NOT NULL DEFAULT '',
  -- Set when the item was generated from a Kairos booking, so the day view can
  -- show one line instead of two for the same meeting.
  booking_id     TEXT REFERENCES bookings(id) ON DELETE SET NULL,
  -- Where this item is in the assistant's workflow. An assistant arranging a
  -- trip needs somewhere to put a half-booked flight that the principal must
  -- not see yet; a principal's day sheet is worthless if it mixes maybes with
  -- what is actually happening. So:
  --   draft     — the assistant's working copy. Never on the principal's day.
  --   proposed  — sent to the principal as a request, awaiting their decision.
  --   confirmed — on the principal's day. What they can plan around.
  -- The column defaults to 'confirmed' so existing rows, and anything a
  -- principal enters for themselves, are live immediately. Only the assistant
  -- path starts at 'draft'.
  status         TEXT NOT NULL DEFAULT 'confirmed',
  proposal_note  TEXT NOT NULL DEFAULT '',  -- why the assistant is asking
  proposed_at    TEXT,
  decision_note  TEXT NOT NULL DEFAULT '',  -- the principal's reason, on decline
  decided_at     TEXT,
  decided_by     TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_itinerary_owner_time ON itinerary_items(owner_id, start_at);
-- NOTE: indexes over columns added by a later migration (status, stage_id and
-- friends) are NOT declared in this file. On a database that already has the
-- table, CREATE TABLE IF NOT EXISTS is a no-op, so the column does not exist
-- yet when this file runs and the index fails with "column does not exist" —
-- taking the whole migration down. They are created in lib/db.js immediately
-- after the column they depend on.

-- Two-way Google/Outlook sync (blueprint Section 3.6, Gap 3). Architecture
-- only — inert until real OAuth client credentials are configured via env
-- vars; see lib/calendarSync.js.
CREATE TABLE IF NOT EXISTS calendar_connections (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL, -- google | outlook
  status        TEXT NOT NULL DEFAULT 'disconnected',
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE(owner_id, provider)
);

-- ============================================================
-- Collaboration layer (Phase 3A) — spaces, threads, two registers
-- ============================================================

-- Every project and conversation lives in exactly one space, and a space has
-- exactly one context. This column is the isolation boundary: nothing is ever
-- read across it without the reader holding membership on the far side.
--
-- private is not "a space whose members were removed" — routes/spaces.js
-- refuses to create a member row against it at all, so the guarantee is
-- structural rather than a permission flag that could be flipped by mistake.
CREATE TABLE IF NOT EXISTS spaces (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  context    TEXT NOT NULL DEFAULT 'work', -- work | personal | private
  -- Which assistant roles are auto-granted access when the owner adds them,
  -- as a comma-separated list of account_category values. Defaults per
  -- context (work: all assistants, personal: none, private: always empty) and
  -- the owner tunes it per space — role sets the opening position, not a
  -- ceiling. See docs/collaboration-spec.html section 03.
  auto_delegate_roles TEXT NOT NULL DEFAULT '',
  -- standard | direct. The direct line is a space the app maintains rather
  -- than one the owner made: exactly one per principal, membership mirrored
  -- from memberships. Marking it means the app can find it without guessing
  -- from the name, and the client can render it as a room rather than a
  -- project workspace. See lib/directLine.js.
  kind       TEXT NOT NULL DEFAULT 'standard',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spaces_owner ON spaces(owner_id);

CREATE TABLE IF NOT EXISTS space_members (
  id         TEXT PRIMARY KEY,
  space_id   TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- owner | member | guest. Distinct from account_category: that's who someone
  -- is, this is what they may do here.
  role       TEXT NOT NULL DEFAULT 'member',
  -- Chiefs of Staff coordinate the rest of the team, so they alone can grant
  -- and revoke other assistants' access. The one genuinely hierarchical
  -- capability among the assistant roles.
  can_delegate INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(space_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_space_members_space ON space_members(space_id);
CREATE INDEX IF NOT EXISTS idx_space_members_user ON space_members(user_id);

-- A project always sits inside exactly one space, so it inherits that space's
-- context and isolation rules rather than carrying its own.
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  space_id    TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active', -- active | done | archived
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_space ON projects(space_id);

-- The formal spine a project's conversation hangs off. Ordered by position;
-- each stage owns exactly one thread, created with it.
--
-- status is stored rather than derived, so an owner can set it by hand — but
-- records move it too (see lib/stageStatus.js): an open Blocker forces
-- 'blocked', an accepted Sign-off forces 'done'. That's what stops the formal
-- register being ceremony: filing a record is the thing that actually moves
-- the project.
CREATE TABLE IF NOT EXISTS project_stages (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'not_started', -- not_started | active | blocked | done
  owner_user_id TEXT REFERENCES users(id),
  due_at        TEXT,
  reminder_stage TEXT, -- null | due_soon | overdue, so each nudge fires once
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_stages_project ON project_stages(project_id, position);

CREATE TABLE IF NOT EXISTS threads (
  id         TEXT PRIMARY KEY,
  space_id   TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  stage_id   TEXT REFERENCES project_stages(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'group', -- group | dm | stage
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_threads_space ON threads(space_id);

-- One table, two registers. A note is chat; a record is a structured, citable
-- entry in the thread's formal history. The record_* columns are NULL for
-- notes.
--
-- promoted_from_id is the whole point: a record made from a note keeps a
-- permanent link back to it, and carries the original author, so authority
-- comes from whose words were captured rather than who filed them.
CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,
  thread_id     TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  -- Whose words these are. For a promoted record this stays the note's author,
  -- not the person who promoted it.
  author_id     TEXT NOT NULL REFERENCES users(id),
  body          TEXT NOT NULL,
  register      TEXT NOT NULL DEFAULT 'note', -- note | record
  record_type   TEXT,   -- decision | approval | request | update | sign_off | blocker
  record_status TEXT,   -- open | accepted | declined | superseded
  record_seq    INTEGER, -- per-thread counter, rendered as R-07
  promoted_from_id TEXT REFERENCES messages(id),
  promoted_by_id   TEXT REFERENCES users(id), -- who filed it, if different from author
  supersedes_id    TEXT REFERENCES messages(id),
  -- Set the moment a record's first acknowledgement lands. After that the body
  -- is frozen and disagreement has to take the form of a superseding record,
  -- so an acknowledged decision can never silently change under the people who
  -- acknowledged it.
  locked_at     TEXT,
  created_at    TEXT NOT NULL,
  edited_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);

-- A task can hang off a stage, a project, or nothing but the space itself (a
-- loose to-do). What matters most is source_message_id: a task made from a
-- message keeps a link back to the conversation that produced it, so opening
-- the task later shows you why it exists — the same instinct as promoting a
-- note to a record, applied to work rather than to the record.
--
-- reminder_stage records how far along the nudging has got (null -> due_soon
-- -> overdue) so each reminder fires exactly once instead of every sweep.
CREATE TABLE IF NOT EXISTS tasks (
  id                TEXT PRIMARY KEY,
  space_id          TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  project_id        TEXT REFERENCES projects(id) ON DELETE CASCADE,
  stage_id          TEXT REFERENCES project_stages(id) ON DELETE CASCADE,
  source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  assignee_id       TEXT REFERENCES users(id),
  created_by        TEXT NOT NULL REFERENCES users(id),
  due_at            TEXT,
  priority          TEXT NOT NULL DEFAULT 'normal', -- low | normal | high
  status            TEXT NOT NULL DEFAULT 'open',   -- open | doing | blocked | done
  reminder_stage    TEXT,
  completed_at      TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_space ON tasks(space_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_stage ON tasks(stage_id);

CREATE TABLE IF NOT EXISTS message_acks (
  id         TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acked_at   TEXT NOT NULL,
  UNIQUE(message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_message_acks_message ON message_acks(message_id);

-- WhatsApp Business API notifications. Architecture only — inert until a
-- real WhatsApp Business token is configured.
CREATE TABLE IF NOT EXISTS whatsapp_connections (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  phone_number  TEXT,
  status        TEXT NOT NULL DEFAULT 'disconnected',
  created_at    TEXT NOT NULL
);

-- ============================================================
-- Custody layer: two-factor auth, essentials, and the access log
-- ============================================================

-- Second factor. Kept in its own table rather than columns on `users` so a
-- routine SELECT * on a user never carries the secret along with it into a
-- log line or an API response.
CREATE TABLE IF NOT EXISTS user_totp (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Encrypted with the same key as everything else: a database dump must not
  -- hand over the ability to mint valid codes.
  secret_enc  TEXT NOT NULL,
  -- Set only once the first correct code proves the phone actually scanned it.
  -- Until then the account is not protected and must not be treated as if it
  -- were.
  confirmed_at TEXT,
  created_at  TEXT NOT NULL
);

-- Recovery codes for the phone that ends up in a river. Hashed, like
-- passwords — single-use, and marked used rather than deleted so someone can
-- see how many they have left.
CREATE TABLE IF NOT EXISTS user_recovery_codes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recovery_user ON user_recovery_codes(user_id);

-- The things people are asked for and cannot recall: passport numbers, seat
-- preferences, loyalty numbers, sizes, insurance policies.
--
-- Attached to a *person*, who may be the account holder or one of their
-- contacts — because a PA books for the spouse and the children too, and a
-- design that only holds the principal's own details fails on the first
-- family trip.
--
-- `sensitivity` drives who may see it. A delegate engaged for scheduling has
-- every reason to know about a nut allergy and none to see a passport.
CREATE TABLE IF NOT EXISTS essentials (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Exactly one of these is set. subject_user_id for the account holder,
  -- subject_contact_id for anyone else in their party.
  subject_user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  subject_contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,   -- see lib/essentials.js for the catalogue
  field         TEXT NOT NULL,   -- e.g. 'passport_number', 'seat_preference'
  label         TEXT NOT NULL DEFAULT '',
  -- Plain values live here; sensitive ones live encrypted in value_enc and
  -- this stays NULL. Never both.
  value         TEXT,
  value_enc     TEXT,
  sensitivity   TEXT NOT NULL DEFAULT 'ordinary', -- ordinary | sensitive
  -- Expiry is the point of the whole feature: a passport under six months'
  -- validity turns someone away at check-in.
  expires_on    TEXT,            -- 'YYYY-MM-DD'
  -- Data entered once and never checked is worse than none, because it looks
  -- authoritative. This is an assistant saying "I held the document and this
  -- is what it says", with the date they said it.
  verified_at   TEXT,
  verified_by   TEXT REFERENCES users(id),
  notes         TEXT NOT NULL DEFAULT '',
  reminder_stage TEXT,           -- null | due_soon | overdue, so each nudge fires once
  created_by    TEXT NOT NULL REFERENCES users(id),
  updated_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_essentials_owner ON essentials(owner_id);

-- Who looked at what, and when.
--
-- Two jobs. If something ever leaks, this is the only way to say who saw it.
-- And people behave differently when they know a reveal is recorded — which
-- is the larger effect. Shown back to the principal, so it reads as
-- reassurance rather than surveillance: "your Chief of Staff viewed your
-- passport on 3 August".
CREATE TABLE IF NOT EXISTS access_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  essential_id TEXT,             -- kept as a plain id: the log outlives the row
  action      TEXT NOT NULL,     -- reveal | create | update | delete
  field       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_log_subject ON access_log(subject_owner_id, created_at);

-- ============================================================
-- Connections — peers across principals
-- ============================================================

-- Two assistants who work for different principals, arranging a meeting
-- between their bosses. This is the most common conversation in the job and
-- the app had no place for it: they share no principal, no space, and no
-- membership, so nothing in the model connected them at all.
--
-- A connection is deliberately NOT a delegation. It grants no access to
-- either side's principal, data, calendar or team — only a line of
-- communication. That is why it is its own table rather than a role on
-- memberships: there is no query anywhere that could mistake one for the
-- other.
--
-- Reached by typing an exact handle. There is no search and no directory, and
-- a request against a handle that does not exist is answered exactly like one
-- that does, so this cannot be used to discover who is on Kairos.
CREATE TABLE IF NOT EXISTS connections (
  id            TEXT PRIMARY KEY,
  requester_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined | ended
  note          TEXT NOT NULL DEFAULT '',        -- one line of context sent with the request
  space_id      TEXT REFERENCES spaces(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  responded_at  TEXT,
  UNIQUE(requester_id, addressee_id)
);
CREATE INDEX IF NOT EXISTS idx_connections_addressee ON connections(addressee_id, status);
CREATE INDEX IF NOT EXISTS idx_connections_requester ON connections(requester_id, status);

-- ============================================================
-- Household — staff, and the instructions they are given
-- ============================================================

-- A driver, cook, housekeeper or nanny.
--
-- A separate table from memberships, and that is the entire security design.
-- `requirePaAccess` grants on any active membership whatever the role, and
-- five other queries do the same; a household role added to that table would
-- have handed a cook the approval queue, contacts, briefs and the ordinary
-- tier of the essentials vault at six call sites at once. Keeping them out of
-- it means no existing query can include them by accident — structural, like
-- private spaces, rather than a flag someone could flip later.
--
-- job_title is free text and carries no access whatever. A driver and a chef
-- see the same thing: what was addressed to them.
CREATE TABLE IF NOT EXISTS household_members (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  invited_email  TEXT NOT NULL,
  name           TEXT NOT NULL DEFAULT '',
  job_title      TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'invited', -- invited | active | revoked
  invite_token   TEXT NOT NULL UNIQUE,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_household_owner ON household_members(owner_id);
CREATE INDEX IF NOT EXISTS idx_household_member ON household_members(member_user_id);

-- "Car at 7:15 for Heathrow." One line, one person, one acknowledgement.
--
-- Not a task and not a message: a task lives in a space and a message lives in
-- a thread, and both would have required giving household staff space
-- membership — which is where everything else in the app lives. This stays in
-- its own compartment.
CREATE TABLE IF NOT EXISTS household_instructions (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_id       TEXT NOT NULL REFERENCES household_members(id) ON DELETE CASCADE,
  author_id       TEXT NOT NULL REFERENCES users(id),
  body            TEXT NOT NULL,
  due_at          TEXT,
  -- open: sent. acknowledged: they have seen it and taken it on. done: it
  -- happened. The middle state is the one that matters — "did the driver
  -- actually get this" is the question being asked at 6am.
  status          TEXT NOT NULL DEFAULT 'open',
  acknowledged_at TEXT,
  done_at         TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_household_instr_member ON household_instructions(member_id, status);
CREATE INDEX IF NOT EXISTS idx_household_instr_owner ON household_instructions(owner_id, created_at);

-- Enough of a line back to be useful: "traffic on the bridge, I'll be ten
-- minutes". Without it this is a notice board rather than a working channel.
CREATE TABLE IF NOT EXISTS household_replies (
  id             TEXT PRIMARY KEY,
  instruction_id TEXT NOT NULL REFERENCES household_instructions(id) ON DELETE CASCADE,
  author_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body           TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_household_replies_instr ON household_replies(instruction_id, created_at);

-- ============================================================
-- Announcements — one way, from the people running Kairos
-- ============================================================

-- The useful half of "a community for PAs", without the half that would hurt.
--
-- A forum where assistants discuss their principals, from accounts traceable
-- to named executives, is the opposite posture to everything else here — and
-- no permission check catches that kind of leak, because the person posting
-- does not experience it as one. A broadcast channel keeps the information and
-- the notices, carries no moderation surface, and cannot be turned into a
-- directory of who is on Kairos.
--
-- Who may post is read from ANNOUNCEMENT_AUTHORS in the environment, not from
-- a column. There is deliberately no way to grant yourself this from inside
-- the app, and nothing in the database to flip.
CREATE TABLE IF NOT EXISTS announcements (
  id           TEXT PRIMARY KEY,
  author_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  -- everyone | assistants | principals | household. Aimed rather than blasted:
  -- a notice meant for assistants is the thing a PA actually wanted from a
  -- community, and a principal does not need to read it.
  audience     TEXT NOT NULL DEFAULT 'everyone',
  -- Draft until published. Writing a notice to several thousand people is
  -- worth being able to do in two sittings.
  published_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_announcements_published ON announcements(published_at);

CREATE TABLE IF NOT EXISTS announcement_reads (
  id              TEXT PRIMARY KEY,
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TEXT NOT NULL,
  UNIQUE(announcement_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_user ON announcement_reads(user_id);

-- ============================================================
-- The day as a chain (see lib/cascade.js)
-- ============================================================
--
-- These four columns are added to itinerary_items by migration in lib/db.js,
-- not here, because the table long predates them:
--
--   is_anchor            A flight departs when it departs. An anchor is never
--                        moved by a cascade; if the day would overrun it, that
--                        is a conflict to be told about, not a time to rewrite.
--   travel_minutes       How long it takes to get here from the previous thing.
--                        Without it a cascade computes a schedule that is
--                        arithmetically valid and physically impossible.
--   household_member_id  Who is driving this leg. The reason a delay can reach
--                        the person standing next to a car.
--   serves_id            This item exists to get them to that one. A car
--                        serves a flight; a check-out serves the car.

-- ============================================================
-- Pairing codes — how a principal brings on an assistant
-- ============================================================
--
-- An emailed invitation needs a working mailbox and a configured provider. A
-- code a principal reads down the phone needs neither, which is the whole
-- point: onboarding an assistant should not depend on infrastructure the
-- principal has no view of.
--
-- Redeeming takes the principal's handle AND the code. Not the code alone —
-- two principals will eventually choose the same phrase, and a bare global
-- code is a bearer token guessable against every account in the system at
-- once. With the handle you must already know who you are targeting, and the
-- collision problem disappears entirely.
--
-- Armed rather than standing. Off by default, live for a window the principal
-- sets, spent after a set number of joins. A credential to an executive's
-- calendar that exists only in the hour it is needed cannot leak six months
-- later out of an old message.
CREATE TABLE IF NOT EXISTS access_codes (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  -- What redeeming it grants. The principal decides when they set it: a new
  -- Chief of Staff and a stand-in driver should not arrive with the same
  -- remit just because they arrived the same way.
  role         TEXT NOT NULL DEFAULT 'pa',
  expires_at   TEXT NOT NULL,
  uses_allowed INTEGER NOT NULL DEFAULT 2,
  uses_spent   INTEGER NOT NULL DEFAULT 0,
  revoked_at   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_codes_owner ON access_codes(owner_id, created_at);

-- Voice notes on the direct line.
--
-- A principal in a car will not type. They will talk — and they talk more
-- freely than they type: a note that would have read "push the 3pm" arrives as
-- "push the 3pm, I'm still with the lawyer and I don't want it discussed."
-- That is vault-grade content coming in through a chat box, which is why the
-- recording is stored the same way a passport number is: encrypted with a key
-- held outside the database, and never written to disk in the clear.
--
-- The audio is a row, not a file. Kairos has no object store, and a recording
-- on a container's disk is gone at the next restart — the same reason the app
-- refuses to call ephemeral storage durable. At ~90 KB a note there is room
-- for years of ordinary use before that trade needs revisiting.
--
-- It expires, and that is deliberate. A voice note in a direct line is
-- operational — "car's outside", "she is twenty minutes late" — and its useful
-- life is hours. Audio kept forever is a liability that accrues in silence.
-- When transcription arrives the text becomes the durable record and the
-- recording still goes.
CREATE TABLE IF NOT EXISTS voice_notes (
  id           TEXT PRIMARY KEY,
  message_id   TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  thread_id    TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  author_id    TEXT NOT NULL REFERENCES users(id),
  mime_type    TEXT NOT NULL,
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  byte_size    INTEGER NOT NULL DEFAULT 0,
  -- Ciphertext only, in secretBox's v1:iv:tag:data form. A database dump that
  -- leaks is a pile of unplayable base64 without the running server's key.
  audio        TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voice_notes_message ON voice_notes(message_id);
CREATE INDEX IF NOT EXISTS idx_voice_notes_expiry ON voice_notes(expires_at);

-- A trip, as one thing.
--
-- Before this, "the London trip" was a handful of itinerary items that
-- happened to sit near each other. Nothing could be asked of it: which hotel,
-- who else is coming, what timezone the principal is actually in on Thursday,
-- cancel the whole thing. Every one of those questions needs the journey to
-- exist as an object rather than as a coincidence of dates.
CREATE TABLE IF NOT EXISTS trips (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by    TEXT NOT NULL REFERENCES users(id),
  name          TEXT NOT NULL,
  destination   TEXT NOT NULL DEFAULT '',
  -- The zone the principal is actually in while they are there. This is what
  -- makes their day render in local time instead of the one on their profile,
  -- which is the difference between a travel feature and a calendar with
  -- flights in it.
  destination_timezone TEXT,
  -- Local dates at the destination, inclusive. Deliberately dates and not
  -- instants: "am I away on the 14th" is a question about a calendar, not a
  -- clock.
  starts_on     TEXT NOT NULL,
  ends_on       TEXT NOT NULL,
  -- Mirrors itinerary_items: an assistant needs somewhere to build a trip the
  -- principal must not see yet.
  status        TEXT NOT NULL DEFAULT 'draft',  -- draft | proposed | confirmed | cancelled
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trips_owner ON trips(owner_id, starts_on);

-- Who else is going. A principal rarely travels alone, and the passport
-- details of a spouse or an aide are already storable — essentials takes a
-- subject_contact_id — with nothing until now to tie them to a journey.
CREATE TABLE IF NOT EXISTS trip_travellers (
  id          TEXT PRIMARY KEY,
  trip_id     TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  contact_id  TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT '',   -- spouse, aide, security, colleague
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trip_travellers ON trip_travellers(trip_id);

-- Who to call at the far end. The office there, the host, the fixer, the
-- doctor somebody recommended. Not contacts in the CRM sense — these are
-- specific to one journey and should leave with it.
CREATE TABLE IF NOT EXISTS trip_contacts (
  id          TEXT PRIMARY KEY,
  trip_id     TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trip_contacts ON trip_contacts(trip_id);

-- The concierge desk, declared before it opens. See lib/concierge.js: what is
-- missing is a contracted network of people, not a credential, so the only
-- thing this table holds is somebody saying they want it — which is a real
-- fact, really recorded, and says so on the screen that collects it.
CREATE TABLE IF NOT EXISTS concierge_interest (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  service     TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_concierge_interest ON concierge_interest(owner_id);

-- What a plan would have refused, while enforcement is still off.
--
-- Aggregated per account and feature rather than appended per event: the
-- question is "which boundaries are in the wrong place", and a row per click
-- would be a log rather than an answer. See lib/plans.js.
CREATE TABLE IF NOT EXISTS plan_signals (
  id        TEXT PRIMARY KEY,
  owner_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature   TEXT NOT NULL,
  plan      TEXT NOT NULL,
  times     INTEGER NOT NULL DEFAULT 1,
  first_at  TEXT NOT NULL,
  last_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_signals ON plan_signals(owner_id, feature);

-- One account's connection to one connector. Replaces the per-provider tables
-- that came before it, which were the same three columns written twice.
-- See lib/connectors.js.
CREATE TABLE IF NOT EXISTS connector_connections (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_id  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'disconnected',
  account_label TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  UNIQUE(owner_id, connector_id)
);
CREATE INDEX IF NOT EXISTS idx_connector_connections ON connector_connections(owner_id);

-- Travel-time answers, bucketed by quarter hour. Traffic does not change
-- meaningfully between 09:01 and 09:07 and every lookup is billed, so an
-- assistant nudging a meeting and re-estimating pays once. See lib/travelTime.js.
CREATE TABLE IF NOT EXISTS travel_estimates (
  id           TEXT PRIMARY KEY,
  origin       TEXT NOT NULL,
  destination  TEXT NOT NULL,
  depart_at    TEXT NOT NULL,
  minutes      INTEGER NOT NULL,
  with_traffic INTEGER NOT NULL DEFAULT 0,
  distance_km  REAL,
  created_at   TEXT NOT NULL
);

-- The shape of a visa, so a trip can be checked against it. The NUMBER is not
-- here: it is sensitive, and the vault already has encryption, custody rules
-- and a second factor for exactly that. One sensitive datum, one guard.
-- See lib/visas.js.
CREATE TABLE IF NOT EXISTS visas (
  id                 TEXT PRIMARY KEY,
  owner_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Whose visa, when a spouse or child is travelling too.
  subject_contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  -- The vault row holding the number, if somebody recorded it.
  essential_id       TEXT REFERENCES essentials(id) ON DELETE SET NULL,
  country            TEXT NOT NULL,
  kind               TEXT NOT NULL,
  entries_total      INTEGER,
  entries_used       INTEGER NOT NULL DEFAULT 0,
  valid_from         TEXT,
  valid_to           TEXT,
  notes              TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visas_owner ON visas(owner_id, country);

-- What actually happened to a booking, in order.
--
-- The bookings row holds state, not story. It says a meeting is confirmed for
-- Thursday; it cannot say that it was booked for Tuesday, moved twice, that
-- the office suggested a video call and the booker agreed, or who called it
-- off. Rescheduling in particular overwrote start_at in place, so the time
-- first agreed was simply gone — which for a custody product is the wrong
-- default: a principal asking "when did we originally say?" deserves an
-- answer.
--
-- Append-only by convention. Nothing here is ever updated or deleted; a
-- correction is another row. See lib/bookingEvents.js for the vocabulary.
CREATE TABLE IF NOT EXISTS booking_events (
  id            TEXT PRIMARY KEY,
  booking_id    TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  -- Denormalised so a principal's trail can be scoped without joining through
  -- bookings, and so it goes when the account does.
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  -- The office member who did it. NULL when it was the booker, who has no
  -- account, or Kairos acting on its own.
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Who it was when there is no account to point at: the booker's name as
  -- given, frozen at the time, because they may rename themselves later.
  actor_label   TEXT NOT NULL DEFAULT '',
  from_value    TEXT,
  to_value      TEXT,
  note          TEXT NOT NULL DEFAULT '',
  at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_booking_events_booking ON booking_events(booking_id, at);
CREATE INDEX IF NOT EXISTS idx_booking_events_owner ON booking_events(owner_id, at);

-- How far each person has read in each thread.
--
-- message_acks, which already exists, is a different thing: a deliberate
-- acknowledgement of a record, which somebody presses on purpose and which
-- means "I have seen this and I am accountable for having seen it". This is
-- the ordinary one — the high-water mark of having looked at a thread, written
-- without being asked, so the rail can say where there is something new.
--
-- Absent means never opened, which counts every message in the thread as
-- unread. That is right: a thread somebody has never looked at is entirely new
-- to them.
CREATE TABLE IF NOT EXISTS thread_reads (
  thread_id    TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_thread_reads_user ON thread_reads(user_id);

-- What broke, so somebody can find out before a customer writes in.
--
-- Deliberately narrow. A crash report is a place personal data goes to hide —
-- request bodies carry passport numbers, query strings carry the capability
-- that opens a booking, and a stack trace can carry either. So the body is
-- never read, the query string is dropped, and the signed-in user is an id
-- rather than a name. See lib/errorReports.js.
--
-- ON DELETE SET NULL rather than CASCADE: closing an account must not quietly
-- erase the evidence that the app failed while they were using it.
CREATE TABLE IF NOT EXISTS error_reports (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL DEFAULT 'server',  -- server | client
  route       TEXT NOT NULL DEFAULT '',
  method      TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL DEFAULT '',
  stack       TEXT NOT NULL DEFAULT '',
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  user_agent  TEXT NOT NULL DEFAULT '',
  -- The same fault seen twice shares this, so a screen can say it happened
  -- four hundred times rather than listing it four hundred times.
  fingerprint TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_error_reports_at ON error_reports(created_at);
CREATE INDEX IF NOT EXISTS idx_error_reports_fp ON error_reports(fingerprint, created_at);
