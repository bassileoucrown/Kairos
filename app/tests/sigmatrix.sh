#!/bin/bash
set -u
SC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
run() {
  local label="$1"; shift
  echo "=== $label ==="
  for suite in bsignal btrip; do
    printf '  %-8s ' "$suite"
    env "$@" timeout 400 node "$SC/$suite.js" > /tmp/sm.log 2>&1
    echo "[rc=$?] $(grep -v Experimental /tmp/sm.log | grep -v trace-warn | tail -1)"
  done
}
U="postgres://kairos:kairos@127.0.0.1:5432"
run "Postgres (fresh)"         DATABASE_URL="$U/kfresh"
run "Postgres (named schema)"  DATABASE_URL="$U/kairos" DATABASE_SCHEMA=kairos
run "Postgres (old schema)"    DATABASE_URL="$U/kold"
