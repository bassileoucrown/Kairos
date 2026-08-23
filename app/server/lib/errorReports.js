const crypto = require('crypto');
const db = require('./db');

/**
 * What broke, kept where somebody will see it.
 *
 * Until now a 500 in production existed only in the server log, which nobody
 * reads until a customer has already written in. This records faults in the
 * database instead, so an operator can open a screen and find out — and, when
 * a webhook is configured, pushes them somewhere that interrupts.
 *
 * WHAT IS DELIBERATELY NOT RECORDED. A crash report is a place personal data
 * goes to hide: request bodies carry passport numbers, query strings carry
 * booking capabilities, and a stack trace can carry either. So:
 *
 *   - the body is never read;
 *   - the query string is dropped from the path, keeping only the route;
 *   - message and stack are truncated hard;
 *   - the signed-in user is stored as an id, not a name or an address.
 *
 * The point is to know that something failed, how often, and roughly where.
 * Diagnosing it is a job for a developer with a reproduction, not for a
 * database full of other people's details.
 */

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
const MAX_PATH = 300;

// One line of defence against a loop: a page erroring on every render could
// otherwise write a row per frame until the disk is full.
const RATE_WINDOW_MS = 60000;
const RATE_MAX = 30;
let windowStart = 0;
let windowCount = 0;

function withinRate() {
  const now = Date.now();
  if (now - windowStart > RATE_WINDOW_MS) {
    windowStart = now;
    windowCount = 0;
  }
  windowCount += 1;
  return windowCount <= RATE_MAX;
}

const trim = (v, max) => (v == null ? '' : String(v).slice(0, max));

/**
 * A stable identity for "the same fault", so a screen can say it happened
 * four hundred times rather than listing it four hundred times.
 */
function fingerprintOf({ kind, message, route }) {
  // What varies between occurrences of one fault is stripped, so they land
  // together. Order matters: the broadest patterns would otherwise eat the
  // narrower ones halfway through and leave two shapes where there is one
  // fault.
  //
  // Addresses are in here for a reason that only shows up under load: without
  // them, "no account for ada@example.com" makes one group per person, so the
  // screen lists a thousand rows precisely when a bug is affecting everybody
  // and one row would have said so.
  const generalised = trim(message, MAX_MESSAGE)
    .replace(/[^\s@]+@[^\s@.]+\.[^\s@]+/g, '<email>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    // Any long run of hex — a token, a truncated id, a fingerprint.
    .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
    .replace(/\d+/g, '<n>');
  return crypto.createHash('sha256')
    .update(`${kind}\n${route}\n${generalised}`)
    .digest('hex')
    .slice(0, 16);
}

/** The route without its query string — /api/trips/<id> keeps its shape. */
function routeOf(req) {
  if (!req) return '';
  const raw = req.originalUrl || req.url || '';
  return trim(raw.split('?')[0], MAX_PATH);
}

/**
 * Record a fault. Never throws, never rejects: whatever went wrong is already
 * being handled by the caller, and a failure to write it down must not become
 * a second, louder failure on top of the first.
 */
async function record(err, { req = null, kind = 'server', url = '' } = {}) {
  try {
    if (!withinRate()) return null;

    const message = trim(err?.message || err || 'Unknown error', MAX_MESSAGE);
    const route = kind === 'client' ? trim(String(url).split('?')[0], MAX_PATH) : routeOf(req);
    const row = {
      id: crypto.randomUUID(),
      kind,
      route,
      method: trim(req?.method || '', 10),
      message,
      // A client "stack" is whatever the browser gave us and may be absent.
      stack: trim(err?.stack || '', MAX_STACK),
      user_id: req?.user?.id || null,
      user_agent: trim(req?.headers?.['user-agent'] || '', 300),
      fingerprint: fingerprintOf({ kind, message, route }),
      created_at: new Date().toISOString(),
    };

    await db.prepare(`
      INSERT INTO error_reports
        (id, kind, route, method, message, stack, user_id, user_agent, fingerprint, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.kind, row.route, row.method, row.message, row.stack,
      row.user_id, row.user_agent, row.fingerprint, row.created_at);

    notify(row);
    return row;
  } catch {
    // Deliberately silent. See the note above.
    return null;
  }
}

/**
 * Push somewhere that interrupts, when somewhere has been configured.
 *
 * A plain JSON POST rather than a vendor SDK: the same URL works for Slack,
 * for Discord, and for anything else that accepts a webhook, and it adds no
 * dependency to a server that holds passport numbers.
 */
function notify(row) {
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  const text = `Kairos ${row.kind} error — ${row.message}`
    + (row.route ? `\n${row.method} ${row.route}` : '');
  // Fire and forget, with the failure swallowed: an unreachable webhook must
  // not turn one fault into an unhandled rejection.
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, ...row, stack: undefined }),
  }).catch(() => {});
}

function isNotifyConfigured() {
  return !!process.env.ERROR_WEBHOOK_URL;
}

/**
 * Faults grouped by what they are, worst-and-most-recent first, so the screen
 * opens on the thing worth looking at.
 */
async function summary({ limit = 50 } = {}) {
  const rows = await db.prepare(`
    SELECT fingerprint,
           COUNT(*)      AS occurrences,
           MAX(created_at) AS last_seen,
           MIN(created_at) AS first_seen,
           MAX(kind)     AS kind,
           MAX(route)    AS route,
           MAX(method)   AS method,
           MAX(message)  AS message
    FROM error_reports
    GROUP BY fingerprint
    ORDER BY MAX(created_at) DESC
    LIMIT ?
  `).all(limit);
  return rows.map((r) => ({
    fingerprint: r.fingerprint,
    occurrences: Number(r.occurrences),
    lastSeen: r.last_seen,
    firstSeen: r.first_seen,
    kind: r.kind,
    route: r.route,
    method: r.method,
    message: r.message,
  }));
}

/** One fault, with its most recent occurrences. */
async function detail(fingerprint, { limit = 10 } = {}) {
  const rows = await db.prepare(`
    SELECT * FROM error_reports WHERE fingerprint = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(fingerprint, limit);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    route: r.route,
    method: r.method,
    message: r.message,
    stack: r.stack,
    userId: r.user_id,
    userAgent: r.user_agent,
    createdAt: r.created_at,
  }));
}

/** Clearing is per-fault, because "we fixed that one" is the usual reason. */
async function clear(fingerprint) {
  await db.prepare('DELETE FROM error_reports WHERE fingerprint = ?').run(fingerprint);
}

module.exports = { record, summary, detail, clear, isNotifyConfigured, fingerprintOf };
