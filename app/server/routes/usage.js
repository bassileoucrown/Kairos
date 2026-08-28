const crypto = require('crypto');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { canPublish } = require('../lib/announcements');
const { limit, clientIp } = require('../lib/rateLimit');

// What testers did, counted. See the table comment in schema.sql for the line
// this must not cross.

const router = asyncRouter();
router.use(requireAuth);

/** Identifiers out, shape kept. Same rule as feedback, same reason. */
function shape(route) {
  return String(route || '')
    .split('?')[0]
    .split('/')
    .map((seg) => (/^[0-9a-f-]{8,}$/i.test(seg) ? ':id' : seg))
    .join('/')
    .slice(0, 120);
}

// The client batches, so this is a handful of requests per session rather than
// one per navigation. Generous enough that a busy afternoon is never clipped,
// tight enough that a loop cannot fill the table.
const sendLimiter = limit({
  limit: 120,
  windowMs: 60 * 60 * 1000,
  keys: (req) => [`usage:${req.user.id}`, `usage-ip:${clientIp(req)}`],
  message: 'Too many.',
});

router.post('/', sendLimiter, async (req, res) => {
  const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 50) : [];
  const at = new Date().toISOString();
  for (const e of events) {
    const name = String(e?.event || '').trim().slice(0, 60);
    if (!name) continue;
    await db.prepare(`
      INSERT INTO usage_events (id, user_id, user_label, role, event, route, at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), req.user.id, req.user.name || '',
      req.user.account_category || '', name, shape(e?.route),
      // The server's clock, not the browser's. A device with the wrong date
      // would otherwise scatter events across the timeline and quietly ruin
      // every count on the screen below.
      at,
    );
  }
  // 204: a client reporting what it did gains nothing from an argument about
  // the shape of the report, and must never be slowed by one.
  res.status(204).end();
});

/**
 * What the pilot looks like from outside.
 *
 * Three questions, which are the three a pilot actually asks: who is still
 * using it, what gets used, and what gets opened once and never again.
 */
router.get('/', async (req, res) => {
  if (!canPublish(req.user)) return res.status(404).json({ error: 'Not found.' });
  const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 14, 1), 90);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const [people, byEvent, byRoute] = await Promise.all([
    // WHO IS STILL HERE. The number that matters most in week two of a pilot,
    // and the one nobody thinks to collect until it is too late to know.
    db.prepare(`
      SELECT user_label AS who, role, COUNT(*) AS n, MAX(at) AS last_at
      FROM usage_events WHERE at >= ?
      GROUP BY user_label, role ORDER BY MAX(at) DESC
    `).all(since),
    db.prepare(`
      SELECT event, COUNT(*) AS n FROM usage_events
      WHERE at >= ? GROUP BY event ORDER BY COUNT(*) DESC LIMIT 40
    `).all(since),
    db.prepare(`
      SELECT route, COUNT(*) AS n, COUNT(DISTINCT user_id) AS people
      FROM usage_events WHERE at >= ? AND event = 'screen'
      GROUP BY route ORDER BY COUNT(*) DESC LIMIT 40
    `).all(since),
  ]);

  res.json({
    days,
    people: people.map((p) => ({
      who: p.who, role: p.role, events: Number(p.n), lastAt: p.last_at,
    })),
    events: byEvent.map((e) => ({ event: e.event, count: Number(e.n) })),
    screens: byRoute.map((r) => ({
      route: r.route, views: Number(r.n), people: Number(r.people),
    })),
  });
});

module.exports = { router };
