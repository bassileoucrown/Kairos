#!/bin/bash
# The pairing-code suites against every storage configuration that matters.
set -u
SC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
run() {
  local label="$1"; shift
  echo "=== $label ==="
  for suite in bcode bopen; do
    printf '  %-8s ' "$suite"
    env "$@" timeout 300 node "$SC/$suite.js" > /tmp/m.log 2>&1
    echo "[rc=$?] $(tail -1 /tmp/m.log)"
  done
}
U="postgres://kairos:kairos@127.0.0.1:5432"
run "SQLite"                   DATABASE_URL=
run "Postgres (fresh)"         DATABASE_URL="$U/kfresh"
run "Postgres (named schema)"  DATABASE_URL="$U/kairos" DATABASE_SCHEMA=kairos
run "Postgres (old schema)"    DATABASE_URL="$U/kold"
