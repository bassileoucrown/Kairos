const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const {
  AUDIENCES, canPublish, isConfigured, listFor, unreadCount, serialize,
} = require('../lib/announcements');

const router = asyncRouter();
router.use(requireAuth);

// Reading is one direction and writing is another, and there is no third.
// Nobody replies, nobody posts to each other, and there is nothing here that
// could become a directory of who is on Kairos.

router.get('/', async (req, res) => {
  res.json({
    announcements: await listFor(req.user),
    unread: await unreadCount(req.user),
    canPublish: canPublish(req.user),
    // Said plainly to the people who would otherwise wonder why the composer
    // is missing, and to nobody else.
    configured: isConfigured(),
    audiences: canPublish(req.user)
      ? Object.entries(AUDIENCES).map(([id, label]) => ({ id, label }))
      : undefined,
  });
});

router.post('/:id/read', async (req, res) => {
  const a = await db.prepare('SELECT id FROM announcements WHERE id = ? AND published_at IS NOT NULL')
    .get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found.' });
  await db.prepare(`
    INSERT INTO announcement_reads (id, announcement_id, user_id, read_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (announcement_id, user_id) DO NOTHING
  `).run(crypto.randomUUID(), a.id, req.user.id, new Date().toISOString());
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Writing. Gated on ANNOUNCEMENT_AUTHORS, which lives in the environment —
// there is no request that can add somebody to it.
// ---------------------------------------------------------------------------

function requireAuthor(req, res, next) {
  if (!canPublish(req.user)) {
    // 404 rather than 403: the existence of a broadcast channel and who may
    // write to it is not something an ordinary account needs confirmed.
    return res.status(404).json({ error: 'Not found.' });
  }
  next();
}

router.get('/drafts', requireAuthor, async (req, res) => {
  const rows = await db.prepare(`
    SELECT a.*, u.name AS author_name,
      (SELECT COUNT(*) FROM announcement_reads r WHERE r.announcement_id = a.id) AS read_count
    FROM announcements a JOIN users u ON u.id = a.author_id
    ORDER BY a.published_at IS NULL DESC, a.created_at DESC
    LIMIT 50
  `).all();
  res.json({ announcements: rows.map((a) => serialize(a, { isAuthor: true })) });
});

router.post('/', requireAuthor, async (req, res) => {
  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '').trim();
  const audience = AUDIENCES[req.body?.audience] ? req.body.audience : 'everyone';
  const publish = req.body?.publish === true;

  if (!title) return res.status(400).json({ error: 'Give it a title.' });
  if (!body) return res.status(400).json({ error: 'Write something.' });

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO announcements (id, author_id, title, body, audience, published_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, title.slice(0, 160), body.slice(0, 8000), audience,
    publish ? now : null, now, now);

  const row = await db.prepare(`
    SELECT a.*, u.name AS author_name FROM announcements a
    JOIN users u ON u.id = a.author_id WHERE a.id = ?
  `).get(id);
  res.status(201).json({ announcement: serialize(row, { isAuthor: true }) });
});

router.patch('/:id', requireAuthor, async (req, res) => {
  const row = await db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found.' });

  const { title, body, audience } = req.body || {};
  const updates = [];
  const values = [];
  if (title !== undefined) {
    if (!String(title).trim()) return res.status(400).json({ error: 'Give it a title.' });
    updates.push('title = ?'); values.push(String(title).trim().slice(0, 160));
  }
  if (body !== undefined) {
    if (!String(body).trim()) return res.status(400).json({ error: 'Write something.' });
    updates.push('body = ?'); values.push(String(body).trim().slice(0, 8000));
  }
  if (audience !== undefined) {
    if (!AUDIENCES[audience]) return res.status(400).json({ error: 'Unknown audience.' });
    updates.push('audience = ?'); values.push(audience);
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

  updates.push('updated_at = ?'); values.push(new Date().toISOString());
  values.push(row.id);
  await db.prepare(`UPDATE announcements SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = await db.prepare(`
    SELECT a.*, u.name AS author_name FROM announcements a
    JOIN users u ON u.id = a.author_id WHERE a.id = ?
  `).get(row.id);
  res.json({ announcement: serialize(updated, { isAuthor: true }) });
});

router.post('/:id/publish', requireAuthor, async (req, res) => {
  const row = await db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  if (row.published_at) return res.status(409).json({ error: 'Already published.' });
  await db.prepare('UPDATE announcements SET published_at = ?, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), new Date().toISOString(), row.id);
  res.json({ ok: true });
});

// Withdrawing puts it back to a draft rather than deleting it. A notice that
// went out and was wrong is worth being able to correct and send again.
router.post('/:id/withdraw', requireAuthor, async (req, res) => {
  const row = await db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  await db.prepare('UPDATE announcements SET published_at = NULL, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), row.id);
  res.json({ ok: true });
});

router.delete('/:id', requireAuthor, async (req, res) => {
  const row = await db.prepare('SELECT id FROM announcements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  await db.prepare('DELETE FROM announcements WHERE id = ?').run(row.id);
  res.status(204).end();
});

module.exports = router;
