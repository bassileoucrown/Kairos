# Working notes for Claude

## Pushing

Two separate acts, two separate rules.

**The branch — push on every commit.** Nothing consumes
`claude/kairos-landing-waitlist-13dhgm`: `render.yaml` names no `branch:`, so
Render deploys the default branch, and there are no GitHub Actions. A red tip
on the branch costs nothing, and the container is ephemeral — work that lives
only on local disk is one reclaim away from gone.

**`main` — fast-forward only when both boards are green.** `main` is what
deploys. This is where the gate earns its keep.

Revisit if a PR with preview deploys or branch CI ever appears; branch pushes
would then have consequences again.

## Both boards

Green means both, back to back, from the repository root:

```
bash app/tests/allsuites.sh                      # SQLite
node app/tests/resetpg.js
DATABASE_URL=postgres://kairos:kairos@127.0.0.1:5432/kfresh \
  bash app/tests/allsuites.sh                    # Postgres
```

SQLite is the more permissive backend, so a statement it accepts can still be
rejected by Postgres. Running only one board is running half a board.

## Three things that have each cost an hour

**The client is a build artifact.** The server serves `app/client/dist`, which
is not tracked by git (Render builds it). Any change under `app/client/src` is
invisible to a test until `npx vite build` runs in `app/client`. Editing `src`
mid-board is safe; rebuilding `dist` mid-board contaminates the run.

**59 suites delete `app/server/data/kairos.sqlite` at startup, unconditionally
— there is no `DATABASE_URL` check.** So a SQLite run started alongside a
Postgres board has its database unlinked underneath its live server, and the
symptom is a 401 or a vanished row a long way from the cause. Never run a suite
concurrently with a board.

**Absolute paths in shell commands.** The working directory persists between
calls; a `cp` or a `node` run from a directory left over from an earlier command
fails silently or misleadingly. This has produced two false results.

## Verifying a negative

Asserting that something is absent passes when the code is broken *and* when the
thing was never there. Every high-stakes negative gets a positive control —
break the code deliberately, watch the assertion go red, put it back.

The same applies to a fix: confirm it by reverting it and seeing the failure
return, not by seeing the test pass once. Intermittent failures need a run count,
not a single green.
