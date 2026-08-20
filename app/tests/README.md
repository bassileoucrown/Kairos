# The suites

Fifty-one end-to-end suites. No framework: each is a standalone Node script that
prints ticks and crosses, exits non-zero on failure, and ends with one sentence
saying what it proved. That last line is the point — `Nobody held up a name, and
nobody had to guess` tells you what broke; `12 assertions failed` does not.

Roughly half drive the HTTP API with `fetch`; the rest drive a real browser
through `playwright-core`.

## Running them

```sh
bash app/tests/allsuites.sh     # all 51, sequentially
node app/tests/btravel.js       # one
```

Every suite **spawns and stops its own server on its own port**. Nothing needs
to be running first, and no two suites can interfere. That is not a style
choice — see *Why nothing is shared* below.

Node 22+ is required (`node:sqlite`). The browser suites look for Chromium at
`/opt/pw-browsers/chromium`; set `CHROMIUM_PATH` if yours is elsewhere.

## Against the four database configurations

Anything touching the schema or a query has to pass on all four. The fourth is
the one that catches a column added in the wrong place, and it is the one people
skip.

```sh
bash app/tests/allsuites.sh                                   # SQLite
DATABASE_URL=postgres://…/kfresh  bash app/tests/allsuites.sh # fresh Postgres
DATABASE_URL=postgres://…/kairos DATABASE_SCHEMA=kairos \
                                  bash app/tests/allsuites.sh # named schema
DATABASE_URL=postgres://…/kold    bash app/tests/allsuites.sh # older database
```

`pgmatrix.sh` and `sigmatrix.sh` run narrower slices across those same
configurations when you only need to prove one area.

`bfail` is the one suite that cannot run without Postgres at all: it asserts on
database *failure* modes — a wrong password, a missing database, a garbled URL,
a working one — and cannot tell them apart with nothing listening. Without a
local Postgres it is the single expected red in an otherwise green run.

## Why nothing is shared

Three suites used to borrow a long-running server on port 4000, and all three
failed intermittently. Two causes, and the second is the one that matters.

**The rate limiter is in memory and keyed on the address as well as the
account** — and a successful login clears the account key, never the address
key. One suite could spend another's budget, and the victim reported a product
failure.

**Twenty-seven of these suites delete `app/server/data/kairos.sqlite` before
they start.** A server that outlives one of those deletions goes on writing to a
file that is no longer on disk. The next suite to use it watches its signup
succeed and then finds no account — a failure that points nowhere near its
cause, and which lands on whichever suite happens to run next in alphabetical
order rather than on anything to do with what it tests.

So each suite owns its server, and run order cannot change the result.

## Writing one

- **Assert on behaviour a person would notice**, and make the closing sentence
  say what was proved.
- **Scope every fixture to the run.** A fixed handle or email means the suite
  passes exactly once per database, and then reports a collision that reads like
  a real bug. `const ID = Date.now().toString(36)` and build names from it.
- **Express dates relative to now.** Assertions pinned to absolute dates start
  failing on a Tuesday for no visible reason.
- **Wait on the thing itself, never on a sleep.** A pause long enough today is a
  flake tomorrow. The one exception is waiting out a window you set yourself,
  like the step-up grace in `bcustody` — that is not a guess.
- **Wait for `databaseReady`, not for the port.** The server binds before the
  database is up, deliberately, and every API route answers 503 until it is
  ready. A readiness loop that stops at the first HTTP response hands the suite a
  server that will refuse its signup.
- **Give the suite its own port**, and prefer run-scoped fixtures over deleting
  the database. The twenty-seven that delete it are history, not a pattern.
- **When a suite fails, work out which of the two is wrong before changing
  either.** Several of these exist because the test was right and the code was
  not.

## What is not here

The early `e2e-*.js` scripts from the first build phases are superseded by these
and were not brought across.
