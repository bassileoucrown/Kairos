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
      await ensureColumn('users', 'account_category', "TEXT NOT NULL DEFAULT 'principal'");
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
