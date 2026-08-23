// Empty the Postgres database between suites.
//
// On SQLite this is free: thirty of the suites delete app/server/data/*.sqlite
// before they start, so each one opens on nothing. Postgres has no file to
// delete, so until now every suite in a parity run inherited whatever the
// previous sixty-four had left behind. Suites that count things — "and marks
// nothing else", "the mark is gone from the rail" — then failed on Postgres
// and passed on SQLite, and the difference was the leftovers rather than the
// backend. Two of them did exactly that, and both pass against an empty
// database.
//
// Dropping the schema rather than truncating tables is deliberate: the table
// list changes as the product grows, and a reset that has to be kept in step
// with schema.sql is a reset that will quietly stop covering the newest table.
// The server rebuilds everything on boot anyway.
//
// Not named b*.js, which is what allsuites.sh globs — this is a tool, not a
// suite.
const url = process.env.DATABASE_URL || '';
if (!/^postgres/.test(url)) process.exit(0);

const { Client } = require(`${__dirname}/../server/node_modules/pg`);

(async () => {
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.end();
})().catch((e) => {
  console.error(`could not reset postgres: ${e.message}`);
  process.exit(1);
});
