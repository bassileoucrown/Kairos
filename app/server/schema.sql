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

-- WhatsApp Business API notifications. Architecture only — inert until a
-- real WhatsApp Business token is configured.
CREATE TABLE IF NOT EXISTS whatsapp_connections (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  phone_number  TEXT,
  status        TEXT NOT NULL DEFAULT 'disconnected',
  created_at    TEXT NOT NULL
);
