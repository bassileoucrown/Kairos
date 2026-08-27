const express = require('express');
const crypto = require('crypto');
const { asyncRouter } = require('../lib/asyncRouter');
const { runReminderSweep } = require('../lib/reminders');

const router = asyncRouter();

/**
 * A door for a clock that lives somewhere else.
 *
 * WHY THIS EXISTS. The reminder sweep runs on a timer inside this process, and
 * a free Render web service is STOPPED after about fifteen minutes with no
 * requests — no processes, no timers. So on the free plan a four o'clock
 * meeting can go unannounced simply because nobody touched Kairos between 3:15
 * and 3:30, and it will not arrive late either: the next sweep after wake-up
 * sees the meeting is already inside its own warning window and skips it as
 * too late to be worth saying.
 *
 * Messages and mentions are unaffected — those are sent by the request that
 * creates them, and that request is by definition waking the server. It is
 * only the notices that depend on a clock rather than on somebody doing
 * something that a sleeping container loses.
 *
 * So the clock moves outside: any scheduler that can make an HTTPS request
 * every quarter of an hour hits this, which both wakes the container and runs
 * the sweep in one go.
 *
 * WHY A SHARED SECRET RATHER THAN A SESSION. The caller is a cron service, not
 * a person; there is nobody to log in. And the endpoint must not be openly
 * callable — not because a sweep leaks anything (it returns four counts) but
 * because an unauthenticated endpoint that does real work is a way to make a
 * stranger's request cost this server a full pass over every task, stage,
 * booking and document it holds.
 *
 * TIMING-SAFE, and not as a flourish. A plain === on a secret compares byte by
 * byte and stops at the first difference, so the time it takes to fail leaks
 * how much of the guess was right. That is a real attack against a value that
 * never rotates and can be guessed at leisure.
 *
 * NOT CONFIGURED IS 404, NOT 401. A deployment that has set no secret should
 * look like a deployment with no such endpoint, rather than one advertising a
 * door and inviting attempts at the key.
 */
function configuredSecret() {
  return String(process.env.SWEEP_SECRET || '').trim();
}

function offered(req) {
  const header = req.get('authorization') || '';
  const bearer = /^Bearer\s+(.+)$/i.exec(header);
  if (bearer) return bearer[1].trim();
  // Query string as well, because several free schedulers can only be given a
  // URL and no headers. It is the weaker of the two — a URL ends up in logs
  // and browser history — so the header is what the documentation shows.
  return String(req.query.key || '').trim();
}

function matches(given, expected) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length. Compare a fixed-size digest instead, so every wrong answer costs
  // exactly the same.
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(a).digest(),
    crypto.createHash('sha256').update(b).digest(),
  );
}

async function sweep(req, res) {
  const secret = configuredSecret();
  if (!secret) return res.status(404).json({ error: 'Not found.' });
  const given = offered(req);
  if (!given || !matches(given, secret)) {
    return res.status(401).json({ error: 'Not authorised.' });
  }

  // The same function the in-process timer calls, so an externally driven
  // deployment and a continuously running one cannot drift apart in what a
  // sweep actually means.
  const result = await runReminderSweep();
  res.json({ ok: true, ...result });
}

// Both verbs, one handler. POST is the honest one; GET is there because
// several free schedulers only send GETs. A sweep is not idempotent in the
// strict sense — it stamps what it has sent — but it IS safe to repeat: that
// stamp is exactly what stops a second call notifying anybody twice, so a
// scheduler retrying costs nothing.
router.post('/', sweep);
router.get('/', sweep);

module.exports = router;
