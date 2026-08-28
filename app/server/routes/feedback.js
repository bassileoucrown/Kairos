const crypto = require('crypto');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { limit, clientIp } = require('../lib/rateLimit');

// A tester telling you something, from where they were standing.
// See the table comment in schema.sql for what is kept and what is not.

const router = asyncRouter();
router.use(requireAuth);

const KINDS = new Set(['confusing', 'wrong', 'idea']);

/**
 * The route, with the identifiers taken out.
 *
 * /threads/9f2c-… becomes /threads/:id — enough to know which screen somebody
 * was on, not enough to name the conversation they were in. A pilot's
 * feedback table should not become a second index of who was talking to whom.
 */
function shape(route) {
  return String(route || '')
    .split('?')[0]
    .split('/')
    .map((seg) => (/^[0-9a-f-]{8,}$/i.test(seg) ? ':id' : seg))
    .join('/')
    .slice(0, 120);
}

const reportLimiter = limit({
  limit: 30,
  windowMs: 60 * 60 * 1000,
  keys: (req) => [`fb:${req.user.id}`, `fb-ip:${clientIp(req)}`],
  message: 'That is a lot of reports in one hour. Try again shortly.',
});

router.post('/', reportLimiter, async (req, res) => {
  const { body, kind, route } = req.body || {};
  const text = String(body || '').trim();
  if (!text) return res.status(400).json({ error: 'Say what happened.' });

  await db.prepare(`
    INSERT INTO feedback (id, user_id, user_label, role, kind, route, body, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), req.user.id, req.user.name || '',
    req.user.account_category || '',
    KINDS.has(kind) ? kind : 'confusing',
    shape(route), text.slice(0, 4000), new Date().toISOString(),
  );

  res.status(201).json({ ok: true });
});

/**
 * The pilot's inbox.
 *
 * Owner-only in the sense that matters here: a tester may report and may not
 * read what everybody else reported. During a pilot the reports are candid
 * about colleagues and about the principal, and a screen that showed them to
 * each other would make the next one less candid.
 */
router.get('/', async (req, res) => {
  if (!process.env.OPERATOR_EMAIL
      || req.user.email !== process.env.OPERATOR_EMAIL) {
    return res.status(404).json({ error: 'Not found.' });
  }
  const rows = await db.prepare(
    'SELECT * FROM feedback ORDER BY created_at DESC LIMIT 200',
  ).all();
  res.json({
    feedback: rows.map((f) => ({
      id: f.id, userLabel: f.user_label, role: f.role, kind: f.kind,
      route: f.route, body: f.body, status: f.status, createdAt: f.created_at,
    })),
  });
});

module.exports = { router };
