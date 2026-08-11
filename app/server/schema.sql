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
  role            TEXT NOT NULL DEFAULT 'pa', -- pa | delegate
  status          TEXT NOT NULL DEFAULT 'invited', -- invited | active | revoked
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
CREATE INDEX IF NOT EXISTS idx_threads_stage ON threads(stage_id);

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
