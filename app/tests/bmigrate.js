// A database from before the feature must survive the deploy that adds it.
//
// WHY THIS EXISTS, AND WHY 86 SUITES DID NOT CATCH THE OUTAGE IT IS ABOUT.
// Every other suite starts from an empty database: the SQLite ones delete the
// file, the Postgres ones drop and recreate the schema. So every table in them
// is built by schema.sql's CREATE TABLE, which always has every column. The
// one population that can be broken by a migration — databases that already
// existed — was the one population never tested.
//
// The bug that got through: a CREATE INDEX over parent_task_id was written
// into schema.sql beside the table. On a fresh database that is fine, the
// column having just been created. On an existing one, CREATE TABLE IF NOT
// EXISTS does nothing, the column is still minutes away from being added by
// ready(), and the index takes the whole migration down — locking every
// existing account out of the app with "the database is not available". The
// rule was already written in lib/db.js. Writing it down did not enforce it.
//
// So this suite does two things a fresh-database suite cannot:
//
//   1. A STATIC CHECK, exact and instant: no index in schema.sql may name a
//      column that ready() adds by migration. That is the rule stated as code.
//
//   2. A LIVE ONE: build the current schema, then strip every migrated column
//      back off it, and boot. That is the shape of every database older than
//      the newest feature, all of them at once, and it is derived from the
//      migration list rather than hand-written — so it keeps covering columns
//      added long after anybody reads this comment.
const ROOT = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const URL = 'postgres://kairos:kairos@127.0.0.1:5432/kairos';
const PORT = 4402;
const BASE = `http://127.0.0.1:${PORT}/api`;
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

const dbSource = fs.readFileSync(path.join(ROOT, 'app/server/lib/db.js'), 'utf8');
const schemaSql = fs.readFileSync(path.join(ROOT, 'app/server/schema.sql'), 'utf8');

/**
 * Every column ready() adds after the fact, read out of the source.
 *
 * Read rather than listed, because a list kept here would be a second answer
 * to a question lib/db.js already answers — and two answers to one question
 * drift. The one that drifts is always the copy nobody remembers to update,
 * which in this case would silently stop covering the newest column: exactly
 * the column most likely to be the one that breaks.
 */
function migratedColumns() {
  const out = [];
  const re = /ensureColumn\(\s*'([^']+)'\s*,\s*'([^']+)'/g;
  for (const m of dbSource.matchAll(re)) out.push({ table: m[1], column: m[2] });
  return out;
}

/** Every index schema.sql creates, as { name, table, body }. */
function schemaIndexes() {
  const out = [];
  const re = /CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)\s*\(([^)]*)\)/gi;
  for (const m of schemaSql.matchAll(re)) {
    out.push({ name: m[1], table: m[2], body: m[3] });
  }
  return out;
}

(async () => {
  let Client;
  try {
    ({ Client } = require(`${ROOT}/app/server/node_modules/pg`));
    const probe = new Client({ connectionString: URL, connectionTimeoutMillis: 2000 });
    await probe.connect();
    await probe.end();
  } catch {
    // Same bargain as bfail: a missing development dependency is an
    // environment condition, not a defect, and a board that cries wolf stops
    // being read. Exit 99 so allsuites tallies it apart from a pass.
    console.log('\n  — Postgres is not reachable at 127.0.0.1:5432, so this suite cannot run.');
    console.log('    It upgrades a real database in place and needs one. Nothing here is a');
    console.log('    product fault. Start Postgres to cover this ground.');
    console.log('\nSKIPPED (no database)');
    process.exit(99);
  }

  async function admin(fn) {
    const c = new Client({ connectionString: URL });
    await c.connect();
    try { return await fn(c); } finally { await c.end(); }
  }

  const migrated = migratedColumns();

  // ---- 1. The rule, as a check rather than a comment ----------------------
  head('No index in schema.sql may name a column that arrives by migration:');
  ok('there are migrated columns to check against', migrated.length > 10,
    String(migrated.length));
  const byTable = new Map();
  for (const { table, column } of migrated) {
    if (!byTable.has(table)) byTable.set(table, new Set());
    byTable.get(table).add(column);
  }
  const offenders = schemaIndexes().filter((idx) => {
    const cols = byTable.get(idx.table);
    if (!cols) return false;
    // Word-boundary match so `stage_id` does not answer for `parent_task_id`,
    // and so an index over `space_id` is not blamed for a column called
    // `space_id_something`.
    return [...cols].some((c) => new RegExp(`\\b${c}\\b`).test(idx.body));
  });
  ok('and none does',
    offenders.length === 0,
    offenders.map((o) => `${o.name} ON ${o.table}(${o.body})`).join('; '));

  // ---- 2. The same rule, proved against a running app ---------------------
  head('An existing database, older than every column added since, still boots:');
  await admin(async (c) => {
    await c.query(`DO $$
      DECLARE t text;
      BEGIN
        FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
        LOOP EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', t); END LOOP;
      END $$;`);
    // The current schema, in full — this is "a database that has been running
    // happily", not a museum piece hand-written to look old.
    await c.query(schemaSql);
  });

  // Now age it: take every migrated column back off. CASCADE so the indexes
  // and constraints over them go too, which is what a database that never had
  // the column actually looks like.
  const stripped = [];
  const kept = [];
  await admin(async (c) => {
    for (const { table, column } of migrated) {
      try {
        await c.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${column} CASCADE`);
        stripped.push(`${table}.${column}`);
      } catch (e) {
        // A column another table's foreign key points at cannot be dropped,
        // and that is fine: it was never one of the retrofitted ones in
        // practice. Recorded rather than swallowed, so a growing list here is
        // visible instead of quietly shrinking the coverage.
        kept.push(`${table}.${column}: ${e.message.split('\n')[0]}`);
      }
    }
  });
  ok('the database was aged by stripping the migrated columns',
    stripped.length > 10, `${stripped.length} stripped, ${kept.length} refused`);
  if (kept.length) console.log('      could not strip: ' + kept.join(' | '));

  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATABASE_URL: URL },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    let status = null;
    for (let i = 0; i < 200; i++) {
      try {
        const s = await (await fetch(`${BASE}/status`)).json();
        status = s;
        if (s.databaseReady) break;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    // THE ASSERTION THE OUTAGE WOULD HAVE FAILED. The app came up and said
    // "The database is not available: column parent_task_id does not exist",
    // which is a locked door for every account that already existed.
    ok('the migration completes and the database is ready',
      status?.databaseReady === true,
      status?.databaseError || JSON.stringify(status));

    await admin(async (c) => {
      const back = await c.query(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = current_schema()`,
      );
      const have = new Set(back.rows.map((r) => `${r.table_name}.${r.column_name}`));
      const missing = stripped.filter((s) => !have.has(s));
      ok('and every stripped column was put back', missing.length === 0,
        missing.join(', '));
    });

    // Migrated is not the same as usable: a schema that is right and an app
    // that 500s on every request is still a broken deploy.
    const r = await fetch(`${BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Adaeze Okonkwo',
        email: `mig${Date.now().toString(36)}@x.com`,
        password: 'password123',
        accountCategory: 'principal',
      }),
    });
    ok('and the upgraded database actually serves', r.status === 201, `got ${r.status}`);
  } finally { proc.kill(); }

  console.log(fails === 0
    ? '\nA database older than the newest feature upgrades in place and serves.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
