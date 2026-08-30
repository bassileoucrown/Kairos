const fs = require('fs');
const path = require('path');

// One database interface, two backends.
//
// Set DATABASE_URL and every query runs against Postgres, which is what
// production needs: Render's free web instances have an ephemeral filesystem,
// so a SQLite file there is wiped on every restart and redeploy — accounts and
// all. Leave it unset and it falls back to a local SQLite file, so `npm run
// dev` still needs no database installed.
//
// The API is deliberately the same shape both ways —
// `await db.prepare(sql).get(...args)` — so route code never learns which
// backend it is talking to, and the SQL stays in the portable subset both
// dialects accept.

const USE_PG = !!process.env.DATABASE_URL;
const PG_SCHEMA = (process.env.DATABASE_SCHEMA || '').trim();

/**
 * Refuse a DATABASE_URL that plainly isn't one, before anything tries to
 * connect with it.
 *
 * Pasting a web address here is an easy mistake and, until now, an expensive
 * one: the value looks plausible, so the pool dutifully opens a socket to
 * port 5432 of a host that has no database behind it, the packets go nowhere,
 * and the only symptom is a connection timeout — indistinguishable from a
 * region mismatch or an expired instance. The shape of the string is
 * checkable up front, so check it.
 */
function validateDatabaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return 'It is not a URL at all. A Postgres connection string looks like'
      + ' postgres://user:password@host:5432/databasename';
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    const looksLikeSite = /^https?:$/.test(url.protocol);
    return `The scheme is "${url.protocol.replace(':', '')}", not postgres.`
      + (looksLikeSite
        ? ' That looks like a website address rather than a database —'
        + " a web service's own URL is a common mix-up. Copy the connection"
        + ' string from the database itself; it begins with postgres://'
        : ' It must begin with postgres:// or postgresql://');
  }
  if (!url.username) {
    return 'There is no username in it. A connection string carries credentials:'
      + ' postgres://user:password@host:5432/databasename';
  }
  if (!url.pathname || url.pathname === '/') {
    return 'It names no database. The part after the host is the database name:'
      + ' postgres://user:password@host:5432/databasename';
  }
  return null;
}

// Deliberately not thrown at require time. Throwing here would kill the
// process before it binds a port, putting us right back to a deploy that dies
// with nothing to read. Instead it is surfaced as a database failure like any
// other: the site comes up, /api/status names the problem, and the log spells
// it out.
const CONFIG_ERROR = USE_PG
  ? (() => {
      const problem = validateDatabaseUrl(process.env.DATABASE_URL);
      return problem ? `DATABASE_URL is not a Postgres connection string. ${problem}` : null;
    })()
  : null;
const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

let impl;

if (USE_PG && CONFIG_ERROR) {
  // A pool built on a malformed string would only fail later, and less
  // clearly. Fail every call with the real reason instead — and stay on the
  // postgres dialect, so a bad value never silently demotes the app to
  // ephemeral storage.
  const fail = async () => { throw new Error(CONFIG_ERROR); };
  impl = {
    prepare() { return { get: fail, all: fail, run: fail }; },
    exec: fail,
    tx: fail,
    columnExists: fail,
    async close() {},
    dialect: 'postgres',
  };
} else if (USE_PG) {
  const { Pool, types } = require('pg');

  // node-postgres hands back int8 and numeric as strings, because they can
  // exceed what a JS number holds safely. Every such column here is a COUNT,
  // a SUM of a CASE, or MAX(record_seq) — all small integers — and leaving
  // them as strings breaks arithmetic silently: MAX(seq) of "2" plus 1 is
  // "21", not 3. Parse them as numbers so both backends agree.
  types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));   // int8
  types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));       // numeric

  // Free Postgres plans generally allow one instance per account, so Kairos
  // may have to share one with another app. Set DATABASE_SCHEMA and it keeps
  // its tables in a named schema of its own, where a `users` table belonging
  // to something else can't collide with this one. Unset, everything lands in
  // `public` exactly as before.
  //
  // Only an identifier is accepted: the value reaches the server as a startup
  // option and as CREATE SCHEMA, neither of which takes a bind parameter, so
  // anything else is refused outright rather than escaped.
  if (PG_SCHEMA && !/^[a-z_][a-z0-9_]*$/.test(PG_SCHEMA)) {
    throw new Error('DATABASE_SCHEMA must be a plain lowercase identifier, e.g. "kairos".');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Managed Postgres (Render, Supabase, Neon) terminates TLS with a
    // certificate this container has no root for; the connection is still
    // encrypted, we just can't verify the chain from here.
    ssl: process.env.DATABASE_SSL === 'off' ? false : { rejectUnauthorized: false },
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    // node-postgres has no connect timeout by default, which is fine against a
    // host that refuses (instant ECONNREFUSED) and disastrous against one that
    // silently drops packets — a wrong region, an external URL that is
    // firewalled, a host that no longer exists. Then the TCP connect never
    // returns, db.ready() never settles, the server never binds a port, and
    // the platform shows a deploy spinning forever with an empty log. A bound
    // wait turns that into an error someone can act on.
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 10000),
    // Applied during connection startup rather than as a follow-up SET, so
    // there is no window in which a borrowed client is still pointing at
    // `public`.
    ...(PG_SCHEMA ? { options: `-c search_path=${PG_SCHEMA}` } : {}),
  });

  // SQLite uses `?` placeholders; Postgres uses $1..$n. Converting here keeps
  // every call site written one way.
  function toPgPlaceholders(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }

  async function query(sql, args, client) {
    const runner = client || pool;
    return runner.query(toPgPlaceholders(sql), args);
  }

  impl = {
    prepare(sql) {
      return {
        async get(...args) { return (await query(sql, args)).rows[0]; },
        async all(...args) { return (await query(sql, args)).rows; },
        async run(...args) {
          const r = await query(sql, args);
          return { changes: r.rowCount };
        },
      };
    },
    async exec(sql) { await pool.query(sql); },
    /**
     * Runs fn inside a transaction on a single pooled connection.
     * Issuing BEGIN and COMMIT as separate pool queries would be a real bug:
     * they could land on different connections and silently not transact.
     */
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const scoped = {
          prepare(sql) {
            return {
              async get(...args) { return (await query(sql, args, client)).rows[0]; },
              async all(...args) { return (await query(sql, args, client)).rows; },
              async run(...args) {
                const r = await query(sql, args, client);
                return { changes: r.rowCount };
              },
            };
          },
        };
        const result = await fn(scoped);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    async columnExists(table, column) {
      // Scoped to the schema this connection actually writes to. Without that,
      // sharing an instance with another app whose `users` table sits in
      // `public` would report our columns as already present and skip the
      // migration that adds them.
      const r = await pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
        [table, column],
      );
      return r.rowCount > 0;
    },
    async close() { await pool.end(); },
    dialect: 'postgres',
  };
} else {
  const { DatabaseSync } = require('node:sqlite');
  const DATA_DIR = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const sqlite = new DatabaseSync(path.join(DATA_DIR, 'kairos.sqlite'));
  sqlite.exec('PRAGMA foreign_keys = ON;');

  // Wrapped in promises so the calling code is identical to the Postgres path
  // — the whole point of the adapter.
  impl = {
    prepare(sql) {
      const stmt = () => sqlite.prepare(sql);
      return {
        async get(...args) { return stmt().get(...args); },
        async all(...args) { return stmt().all(...args); },
        async run(...args) { return stmt().run(...args); },
      };
    },
    async exec(sql) { sqlite.exec(sql); },
    async tx(fn) {
      sqlite.exec('BEGIN');
      try {
        const result = await fn(impl);
        sqlite.exec('COMMIT');
        return result;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    async columnExists(table, column) {
      const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all();
      return cols.some((c) => c.name === column);
    },
    async close() { sqlite.close(); },
    dialect: 'sqlite',
  };
}

/**
 * Clear the usernames this app invented for people.
 *
 * An earlier version derived a handle for every contact from their name, so
 * that any contact could be written after an @. That was a mistake of the
 * quiet kind: a username belongs to whoever holds the account, and coining one
 * on somebody's behalf — in an office they may never have heard of — makes up
 * an identity for them. Two principals who both knew Tunde Bakare each got a
 * different invented name for the same person.
 *
 * The column stays, because a NOT NULL it never was and dropping a column is a
 * harder migration than emptying one. It is simply no longer written or read:
 * a contact's username is now looked up from the account that owns the
 * address, every time, or is nothing at all.
 */
async function clearInventedContactHandles() {
  await impl.prepare("UPDATE contacts SET handle = NULL WHERE handle IS NOT NULL AND handle != ''").run();
}

// Retrofits columns added after a table already existed — CREATE TABLE IF NOT
// EXISTS won't do it.
async function ensureColumn(table, column, definition) {
  if (await impl.columnExists(table, column)) return;
  await impl.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/** Companion to ensureColumn, for indexes that depend on a retrofitted column. */
async function ensureIndex(name, target) {
  await impl.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${target}`);
}

// A managed database is not always accepting connections the instant the web
// service boots — on a deploy the two start together, and a free-plan instance
// may be waking from idle. A single refused connection used to end the process,
// which the platform reports only as "Deploy failed". Transient network faults
// are retried; anything else (bad credentials, missing database, a syntax error
// in our own schema) fails immediately, because retrying won't fix it.
const TRANSIENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE']);
const CONNECT_ATTEMPTS = Number(process.env.DATABASE_CONNECT_ATTEMPTS || 5);

function isTransient(err) {
  // A connect timeout counts: a free-plan instance waking from idle can blow
  // through the first attempt and answer the second perfectly well.
  return TRANSIENT.has(err.code)
    || /terminating connection|starting up|not yet accepting|connection timeout/i.test(err.message || '');
}

async function connectWithRetry() {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await impl.exec('SELECT 1');
      return;
    } catch (err) {
      if (!isTransient(err) || attempt >= CONNECT_ATTEMPTS) throw err;
      const waitMs = Math.min(1000 * 2 ** (attempt - 1), 16000);
      console.warn(`Database not reachable yet (${err.code || err.message}); retrying in ${waitMs / 1000}s — attempt ${attempt} of ${CONNECT_ATTEMPTS}.`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

// A ceiling on the whole startup, not just one connection. Retries with
// backoff plus a slow schema build could otherwise outlast a platform's
// patience, and a deploy that is killed while waiting leaves no explanation
// at all. Failing on our own terms means the log says what happened.
// Comfortably above the worst honest case (5 attempts x 10s connect, plus
// ~15s of backoff, plus building the schema) and far below the point where a
// human assumes the deploy is wedged.
const READY_TIMEOUT_MS = Number(process.env.DATABASE_READY_TIMEOUT_MS || 120000);

function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Database did not become ready within ${Math.round(ms / 1000)}s.`)),
      ms,
    );
  });
  // unref so a resolved startup doesn't hold the process open on this timer.
  if (typeof timer?.unref === 'function') timer.unref();
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

let readyPromise = null;
/** Creates the schema and applies migrations. Safe to await repeatedly. */
function ready() {
  if (!readyPromise) {
    readyPromise = withDeadline((async () => {
      if (impl.dialect === 'postgres') await connectWithRetry();
      // Must precede the schema file: every connection already points its
      // search_path here, and nothing resolves until the schema exists.
      if (impl.dialect === 'postgres' && PG_SCHEMA) {
        await impl.exec(`CREATE SCHEMA IF NOT EXISTS ${PG_SCHEMA}`);
      }
      await impl.exec(schemaSql);
      await ensureColumn('contacts', 'birthday', 'TEXT');
      await ensureColumn('contacts', 'anniversary', 'TEXT');
      // What to type after the @ to refer to this contact.
      //
      // Contacts are not users and have no slug of their own, so one is
      // derived from the name and kept unique within an owner's contacts —
      // deliberately not globally, since two principals may each know a
      // different Tunde and neither has any business colliding with the other.
      // See lib/mentions.js.
      await ensureColumn('contacts', 'handle', 'TEXT');
      // Every contact that predates the column gets one, so @ works for the
      // whole address book on the first boot after this ships rather than only
      // for people added afterwards. Runs once — the WHERE clause empties
      // itself — and is deliberately done here rather than lazily on read, so
      // no request ever pays for it.
      await clearInventedContactHandles();
      await ensureColumn('users', 'account_category', "TEXT NOT NULL DEFAULT 'principal'");
      // Which plan the account is on. Existing rows land on 'founding' — see
      // lib/plans.js for why that is a fact in the row rather than a promise.
      await ensureColumn('users', 'plan', "TEXT NOT NULL DEFAULT 'founding'");
      // "The thing you asked for has happened", which is not the same claim as
      // "I have seen this". See routes/threads.js.
      await ensureColumn('messages', 'done_at', 'TEXT');
      await ensureColumn('messages', 'done_by', 'TEXT');
      await ensureColumn('threads', 'project_id', 'TEXT REFERENCES projects(id)');
      await ensureColumn('threads', 'stage_id', 'TEXT REFERENCES project_stages(id)');
      await ensureColumn('project_stages', 'reminder_stage', 'TEXT');
      await ensureColumn('memberships', 'can_manage_scheduling', 'INTEGER NOT NULL DEFAULT 1');
      await ensureColumn('itinerary_items', 'status', "TEXT NOT NULL DEFAULT 'confirmed'");
      await ensureColumn('itinerary_items', 'proposal_note', "TEXT NOT NULL DEFAULT ''");
      await ensureColumn('itinerary_items', 'proposed_at', 'TEXT');
      await ensureColumn('itinerary_items', 'decision_note', "TEXT NOT NULL DEFAULT ''");
      await ensureColumn('itinerary_items', 'decided_at', 'TEXT');
      await ensureColumn('itinerary_items', 'decided_by', 'TEXT');
      // Where a pad line went when it outgrew two people. See routes/pad.js.
      await ensureColumn('pad_items', 'thread_id', 'TEXT');
      // What a message is answering. Lets a record, a voice note or the message
      // a task came from be replied to without any of them being unfrozen. See
      // the comment on the column in schema.sql.
      await ensureColumn('messages', 'reply_to_id', 'TEXT');
      // What actually happened at a meeting, as against what to prepare for
      // it. See the comment on the column in schema.sql.
      await ensureColumn('booking_notes', 'kind', "TEXT NOT NULL DEFAULT 'note'");
      // Taking a message back left a tombstone for one release — the row
      // stayed with its body emptied and the line read "Message withdrawn".
      // It is a hard delete now, so these are finished off: every one of them
      // is a message whose author already asked for it to be gone, and a row
      // that says somebody thought better of something is an invitation to ask
      // what it was. The column stays because dropping one is not worth the
      // migration, and nothing writes it any more.
      await ensureColumn('messages', 'withdrawn_at', 'TEXT');
      await impl.prepare('DELETE FROM messages WHERE withdrawn_at IS NOT NULL').run();

      // Every handle in use, recorded as its holder's. Without this the table
      // starts empty, and the first person to change their handle would find
      // it immediately claimable by somebody else — which is the whole thing
      // handle_history exists to prevent. Written as a left join so it is
      // idempotent: on every boot after the first it inserts nothing.
      await impl.prepare(`
        INSERT INTO handle_history (id, user_id, handle, held_at)
        SELECT u.id, u.id, u.slug, u.created_at
        FROM users u
        LEFT JOIN handle_history h ON h.user_id = u.id AND h.handle = u.slug
        WHERE u.slug IS NOT NULL AND u.slug != '' AND h.id IS NULL
      `).run();
      // Finished with, but kept. See the column in schema.sql.
      await ensureColumn('threads', 'archived_at', 'TEXT');
      // Put away, for the two things that could only be thrown away.
      //
      // A COLUMN RATHER THAN A STATUS VALUE, for tasks especially. status is
      // the state of the WORK — open, doing, blocked, done — and "put away" is
      // not a state of the work, it is a decision about the list. Folding it
      // into status would mean archiving a task erases whether it was ever
      // finished, so "done and filed" and "abandoned and filed" become the
      // same row. They are not the same thing and somebody will need to know
      // which.
      await ensureColumn('tasks', 'archived_at', 'TEXT');
      await ensureColumn('spaces', 'archived_at', 'TEXT');
      // What kind of record a kept item was, when it was one. A decision and
      // a blocker read differently in an archive, and once the room is gone
      // there is nothing left to ask — the copy has to carry it.
      await ensureColumn('kept_items', 'record_type', "TEXT NOT NULL DEFAULT ''");
      // Projects had 'archived' as a STATUS, which is the same conflation the
      // tasks column above exists to avoid: a project could be done, or filed,
      // but never both, so filing one erased whether it had finished. The old
      // value still counts as archived — see routes/archive.js — so nothing
      // already put away disappears from the shelf when this lands.
      await ensureColumn('projects', 'archived_at', 'TEXT');
      // Public, or the one the app keeps so the office can slot something into
      // the diary directly. See lib/internalBooking.js.
      await ensureColumn('meeting_types', 'kind', "TEXT NOT NULL DEFAULT 'public'");
      // Whether the "starts in half an hour" nudge has gone for a booking.
      // Nothing swept appointments at all before this: the office knew the
      // meeting was at four and never said so out loud. See lib/reminders.js.
      await ensureColumn('bookings', 'reminder_stage', 'TEXT');
      // Steps inside a task. See the column in schema.sql for why a step is a
      // task rather than a lighter checklist row.
      await ensureColumn('tasks', 'parent_task_id', 'TEXT');
      await ensureIndex('idx_tasks_parent', 'tasks(parent_task_id)');
      // The two people in a room for two. See lib/pairLine.js.
      await ensureColumn('spaces', 'pair_key', 'TEXT');
      await ensureIndex('idx_spaces_pair', 'spaces(pair_key)');
      // A document put away: out of the live vault, out of the expiry nudges,
      // still readable. Unlike a kept message this really is a flag on the
      // row, and the difference is that nothing cascades an essential away —
      // it belongs to the principal directly, so there is nothing for it to
      // outlive. See kept_items in schema.sql for the case where that is false.
      await ensureColumn('essentials', 'archived_at', 'TEXT');
      // Which week's report has already gone to this principal. A date rather
      // than a timestamp, because the question the sweep asks is "have we
      // covered this week" and not "when did we last send something". See
      // sweepWeeklyReports in lib/reminders.js.
      await ensureColumn('users', 'weekly_report_sent_for', 'TEXT');
      // When this person was last using Kairos, and the start of the gap
      // before now if there was one. Two columns rather than one because the
      // gap has to be captured before last_seen_at is overwritten — see
      // touch() in lib/catchUp.js.
      await ensureColumn('users', 'last_seen_at', 'TEXT');
      await ensureColumn('users', 'away_since', 'TEXT');

      // Indexes over columns that arrive by migration, created only once those
      // columns certainly exist.
      //
      // These cannot live in schema.sql. On a database that already has the
      // table, CREATE TABLE IF NOT EXISTS does nothing, so the file would try
      // to index a column that is still minutes away from being added — and
      // "column does not exist" would take the entire migration down, locking
      // out every database created before the feature. Which is exactly the
      // population most in need of migrating.
      await ensureColumn('essentials', 'reminder_stage', 'TEXT');
      await ensureColumn('spaces', 'kind', "TEXT NOT NULL DEFAULT 'standard'");
      // The day as a chain rather than a list. See lib/cascade.js.
      await ensureColumn('itinerary_items', 'is_anchor', 'INTEGER NOT NULL DEFAULT 0');
      await ensureColumn('itinerary_items', 'travel_minutes', 'INTEGER NOT NULL DEFAULT 0');
      await ensureColumn('itinerary_items', 'household_member_id', 'TEXT');
      await ensureColumn('itinerary_items', 'serves_id', 'TEXT');
      // Whether a message actually left the building. See lib/email.js.
      await ensureColumn('emails', 'delivery_status', "TEXT NOT NULL DEFAULT 'outbox'");
      await ensureColumn('emails', 'delivery_error', 'TEXT');
      // When this browser last proved a second factor, for step-up on the
      // vault. See lib/stepUp.js.
      await ensureColumn('sessions', 'stepped_up_at', 'TEXT');
      // Where the second factor is demanded. Defaults to the vault alone:
      // signing in costs the password, and the code is spent on the things
      // worth spending it on. See lib/stepUp.js.
      await ensureColumn('user_totp', 'scope', "TEXT NOT NULL DEFAULT 'vault'");

      // Which device a session belongs to, and when it was last used, so a
      // principal can see everywhere they are signed in and end any of it.
      // See lib/devices.js.
      await ensureColumn('sessions', 'user_agent', 'TEXT');
      await ensureColumn('sessions', 'last_seen_at', 'TEXT');
      await ensureColumn('sessions', 'last_ip', 'TEXT');
      // The question that guards ending another device's session. Not a
      // second factor: the emergency this is for is a lost phone, and the
      // authenticator was on it. See lib/securityQuestion.js.
      await ensureColumn('users', 'security_question', 'TEXT');
      await ensureColumn('users', 'security_answer_hash', 'TEXT');
      // How far ahead the diary is open. Fourteen days used to be a constant
      // in lib/availability.js, which meant every principal on the platform
      // had the same answer to a question that is entirely personal — a
      // barrister opens three months, somebody running a family office opens
      // a week. The default is the old constant so nothing shifts under
      // anybody who has not chosen.
      await ensureColumn('users', 'booking_window_days', 'INTEGER NOT NULL DEFAULT 14');
      // The longest meeting a block of hours will take. Null means "whatever
      // the meeting type asks for", which is what every existing row meant
      // before there was a way to say otherwise.
      await ensureColumn('availability_rules', 'slot_minutes', 'INTEGER');
      // A breather between one meeting and the next, so a day of them is not a
      // day of walking out of one room into another. Ten minutes by default —
      // enough to close a laptop, not enough to lose an hour a day to.
      await ensureColumn('users', 'gap_minutes', 'INTEGER NOT NULL DEFAULT 10');
      // How long before a meeting ends to say so.
      await ensureColumn('users', 'warn_minutes', 'INTEGER NOT NULL DEFAULT 5');
      // A device the principal has vouched for stays signed in, on a sliding
      // window, instead of being turned out every thirty days. See
      // lib/devices.js.
      await ensureColumn('sessions', 'trusted_at', 'TEXT');

      // How a meeting happens, asked for by the booker and agreed by the
      // office. The format lived only on the meeting type before this, so a
      // booking had no way to differ from it. See lib/meetingFormats.js.
      await ensureColumn('bookings', 'format', 'TEXT');
      await ensureColumn('bookings', 'format_note', 'TEXT');
      await ensureColumn('bookings', 'format_state', "TEXT NOT NULL DEFAULT 'agreed'");
      await ensureColumn('bookings', 'counter_format', 'TEXT');
      await ensureColumn('bookings', 'counter_format_note', 'TEXT');

      // Trips. An itinerary item belongs to a journey, and a travel leg needs
      // to say who is meeting the principal and how — see lib/trips.js.
      await ensureColumn('itinerary_items', 'trip_id', 'TEXT');
      // How this leg is being handled. Away from home there is no household
      // driver, and pretending otherwise leaves somebody in an arrivals hall.
      await ensureColumn('itinerary_items', 'arrangement', "TEXT NOT NULL DEFAULT ''");
      await ensureColumn('itinerary_items', 'provider', "TEXT NOT NULL DEFAULT ''");
      await ensureColumn('itinerary_items', 'contact_name', "TEXT NOT NULL DEFAULT ''");
      await ensureColumn('itinerary_items', 'contact_phone', "TEXT NOT NULL DEFAULT ''");
      await ensureColumn('itinerary_items', 'terminal', "TEXT NOT NULL DEFAULT ''");
      await ensureColumn('itinerary_items', 'seat', "TEXT NOT NULL DEFAULT ''");
      // Meeting without a name board. See lib/pickup.js.
      await ensureColumn('itinerary_items', 'pickup_code', "TEXT NOT NULL DEFAULT ''");
      await ensureColumn('itinerary_items', 'pickup_token', 'TEXT');
      // The moment the principal picked this driver out. See lib/pickupSignal.js.
      await ensureColumn('itinerary_items', 'pickup_found_at', 'TEXT');
      // Something that happens again. See lib/recurrence.js for why every
      // occurrence is a real row rather than a rule expanded when somebody
      // looks: almost everything done to an item needs an id, and a virtual
      // occurrence has none. Both columns are null for a one-off, which is
      // what every existing row is.
      await ensureColumn('itinerary_items', 'series_id', 'TEXT');
      await ensureColumn('itinerary_items', 'recurrence', 'TEXT');
      // Whether a journey is the office's business at all. Defaults to
      // 'office', so every trip that already exists stays exactly as visible
      // as it was — a migration that made old trips private would hide work
      // from the people doing it. See lib/tripPrivacy.js.
      await ensureColumn('trips', 'visibility', "TEXT NOT NULL DEFAULT 'office'");
      await ensureIndex('idx_trips_visibility', 'trips(owner_id, visibility)');
      await ensureIndex('idx_itinerary_series', 'itinerary_items(series_id)');
      await ensureIndex('idx_itinerary_trip', 'itinerary_items(trip_id)');
      await ensureIndex('idx_itinerary_pickup', 'itinerary_items(pickup_token)');
      await ensureIndex('idx_itinerary_status', 'itinerary_items(owner_id, status)');
      await ensureIndex('idx_threads_stage', 'threads(stage_id)');
    })(), READY_TIMEOUT_MS);
  }
  return readyPromise;
}

/**
 * Forget a failed attempt so ready() will genuinely try again.
 *
 * ready() memoizes, which is right for the success case — every route awaits
 * it — but wrong for a failure that was only ever temporary. A database being
 * provisioned can take minutes, longer than any sensible startup ladder, and
 * without this the server would sit broken until somebody redeployed it by
 * hand. Only clears a *rejected* promise; a healthy connection is never
 * disturbed.
 */
function resetIfFailed() {
  if (!readyPromise) return;
  readyPromise.catch(() => { readyPromise = null; });
}

module.exports = {
  prepare: (sql) => impl.prepare(sql),
  resetIfFailed,
  exec: (sql) => impl.exec(sql),
  tx: (fn) => impl.tx(fn),
  close: () => impl.close(),
  dialect: impl.dialect,
  ready,
};
