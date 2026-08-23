#!/bin/bash
# Every suite, one after another. Each one spawns and stops its own server on
# its own port, so the order they run in cannot change the result.
#
# It used to start a long-lived shared server on port 4000 for three of them,
# and before that it simply assumed somebody had left one running. Both were
# wrong for the same reason: twenty-seven suites in this directory delete
# app/server/data/kairos.sqlite before they start, and a server that outlives
# one of those deletions keeps writing to a file that is no longer on disk.
# Whichever suite ran next saw a signup succeed and then found no account —
# a failure that pointed nowhere near its cause. A shared server also shares
# one in-memory rate limiter, and the login limiter counts by address as well
# as by account, so a suite that exhausted it made the next one look broken.
set -u
SC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SC"

# Set DATABASE_URL to a Postgres URL to run the whole board against the
# backend production actually uses. Worth doing before a release: SQLite is the
# more permissive of the two, so a statement it accepts can still be rejected
# by Postgres, and that failure is invisible here otherwise. One reached main
# that way — a uniqueness check written as `(? IS NULL OR id != ?)`, which
# Postgres cannot type, turning every attempt to save a contact into a 500.
#
# Each suite gets an empty database, the same way the SQLite ones get an empty
# file. See resetpg.js for why that is not optional.
pass=0; fail=0; failed=""
for f in b*.js; do
  s="${f%.js}"
  printf '%-12s ' "$s"
  if ! node resetpg.js; then echo "FAIL[db] could not reset the database"; fail=$((fail+1)); failed="$failed $s"; continue; fi
  timeout 420 node "$f" > "/tmp/out-$s.log" 2>&1
  rc=$?
  last=$(grep -v ExperimentalWarning "/tmp/out-$s.log" | grep -v 'trace-warnings' | tail -1)
  if [ $rc -eq 0 ]; then pass=$((pass+1)); echo "ok   $last";
  else fail=$((fail+1)); failed="$failed $s"; echo "FAIL[$rc] $last"; fi
done

echo "---- $pass passed, $fail failed"
[ -n "$failed" ] && echo "---- failed:$failed"
exit $([ $fail -eq 0 ] && echo 0 || echo 1)
