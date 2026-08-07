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
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

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
  status           TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | cancelled
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookings_owner_time ON bookings(owner_id, start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_meeting_type ON bookings(meeting_type_id);
