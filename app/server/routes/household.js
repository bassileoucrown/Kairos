const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const db = require('../lib/db');
const { BRAND_FULL } = require('../lib/brand');
const { requireAuth } = require('../lib/auth');
const { sendEmail } = require('../lib/email');
const {
  COMMON_TITLES, requireHouseholdOwner, requireHouseholdInstruct,
  serializeMember, serializeInstruction,
} = require('../lib/household');

const router = asyncRouter();
router.use(requireAuth);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/titles', async (req, res) => {
  res.json({ titles: COMMON_TITLES });
});

// ---------------------------------------------------------------------------
// The staff member's own screen. Their entire app, and the only household
// endpoint that does not name a principal — because they are not choosing
// one, they are being told something.
// ---------------------------------------------------------------------------

router.get('/mine', async (req, res) => {
  const rows = await db.prepare(`
    SELECT i.*, u.name AS author_name, p.name AS principal_name, hm.job_title,
      (SELECT COUNT(*) FROM household_replies r WHERE r.instruction_id = i.id) AS reply_count
    FROM household_instructions i
    JOIN household_members hm ON hm.id = i.member_id
    JOIN users u ON u.id = i.author_id
    JOIN users p ON p.id = i.owner_id
    WHERE hm.member_user_id = ? AND hm.status = 'active'
    ORDER BY i.status = 'done', i.due_at IS NULL, i.due_at ASC, i.created_at DESC
    LIMIT 100
  `).all(req.user.id);

  const posts = await db.prepare(`
    SELECT hm.id, hm.job_title, p.name AS principal_name
    FROM household_members hm
    JOIN users p ON p.id = hm.owner_id
    WHERE hm.member_user_id = ? AND hm.status = 'active'
  `).all(req.user.id);

  res.json({
    posts: posts.map((p) => ({ id: p.id, jobTitle: p.job_title, principalName: p.principal_name })),
    instructions: rows.map((i) => serializeInstruction(i)),
    counts: {
      open: rows.filter((i) => i.status === 'open').length,
      inHand: rows.filter((i) => i.status === 'acknowledged').length,
    },
  });
});

// ---------------------------------------------------------------------------
// A single instruction, from either end. Access is checked against the
// instruction itself rather than a role, so the staff member reaches exactly
// the ones addressed to them and nothing adjacent.
// ---------------------------------------------------------------------------

async function loadInstruction(req, res, next) {
  const row = await db.prepare(`
    SELECT i.*, u.name AS author_name, p.name AS principal_name,
           hm.member_user_id, hm.name AS member_name, hm.job_title, hm.status AS member_status
    FROM household_instructions i
    JOIN household_members hm ON hm.id = i.member_id
    JOIN users u ON u.id = i.author_id
    JOIN users p ON p.id = i.owner_id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Instruction not found.' });

  // `status = 'active'` is load-bearing: without it a dismissed member kept
  // reaching every instruction ever addressed to them by id, long after their
  // access was supposed to have ended.
  const isRecipient = row.member_user_id === req.user.id && row.member_status === 'active';
  let isSender = row.owner_id === req.user.id;
  if (!isSender && !isRecipient) {
    const membership = await db.prepare(`
      SELECT role FROM memberships
      WHERE owner_id = ? AND member_user_id = ? AND status = 'active'
    `).get(row.owner_id, req.user.id);
    isSender = !!membership && ['pa', 'ea', 'chief_of_staff'].includes(membership.role);
  }
  // 404 rather than 403, as everywhere else: not being told a thing exists is
  // stronger than being told you may not see it.
  if (!isSender && !isRecipient) return res.status(404).json({ error: 'Instruction not found.' });

  req.instruction = row;
  req.isRecipient = isRecipient;
  next();
}

router.get('/instructions/:id', loadInstruction, async (req, res) => {
  const replies = await db.prepare(`
    SELECT r.*, u.name AS author_name
    FROM household_replies r JOIN users u ON u.id = r.author_id
    WHERE r.instruction_id = ? ORDER BY r.created_at ASC
  `).all(req.instruction.id);

  res.json({
    instruction: serializeInstruction(req.instruction),
    isRecipient: req.isRecipient,
    replies: replies.map((r) => ({
      id: r.id, body: r.body, authorName: r.author_name, createdAt: r.created_at,
    })),
  });
});

// "Got it." The one gesture that matters, and the reason this is not email:
// the person who sent it can see it landed.
router.post('/instructions/:id/acknowledge', loadInstruction, async (req, res) => {
  if (!req.isRecipient) {
    return res.status(403).json({ error: 'Only the person asked can confirm it.' });
  }
  if (req.instruction.status === 'open') {
    await db.prepare("UPDATE household_instructions SET status = 'acknowledged', acknowledged_at = ? WHERE id = ?")
      .run(new Date().toISOString(), req.instruction.id);
  }
  res.json({ ok: true });
});

router.post('/instructions/:id/done', loadInstruction, async (req, res) => {
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE household_instructions
    SET status = 'done', done_at = ?, acknowledged_at = COALESCE(acknowledged_at, ?)
    WHERE id = ?
  `).run(now, now, req.instruction.id);
  res.json({ ok: true });
});

// "Traffic on the bridge, I'll be ten minutes." Without a line back this is a
// notice board rather than a working channel.
router.post('/instructions/:id/replies', loadInstruction, async (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Say something.' });

  await db.prepare(`
    INSERT INTO household_replies (id, instruction_id, author_id, body, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), req.instruction.id, req.user.id, body.slice(0, 2000), new Date().toISOString());

  // Replying is itself confirmation that it was seen.
  if (req.isRecipient && req.instruction.status === 'open') {
    await db.prepare("UPDATE household_instructions SET status = 'acknowledged', acknowledged_at = ? WHERE id = ?")
      .run(new Date().toISOString(), req.instruction.id);
  }
  res.status(201).json({ ok: true });
});

// ---------------------------------------------------------------------------
// The principal's side: the roster, and what has been asked of it.
// ---------------------------------------------------------------------------

router.get('/:ownerId', requireHouseholdInstruct, async (req, res) => {
  const members = await db.prepare(`
    SELECT hm.*, u.name AS member_name
    FROM household_members hm
    LEFT JOIN users u ON u.id = hm.member_user_id
    WHERE hm.owner_id = ? AND hm.status != 'revoked'
    ORDER BY hm.job_title, hm.created_at
  `).all(req.principal.id);

  const instructions = await db.prepare(`
    SELECT i.*, u.name AS author_name, hm.name AS member_name, hm.job_title,
      (SELECT COUNT(*) FROM household_replies r WHERE r.instruction_id = i.id) AS reply_count
    FROM household_instructions i
    JOIN household_members hm ON hm.id = i.member_id
    JOIN users u ON u.id = i.author_id
    WHERE i.owner_id = ?
    ORDER BY i.created_at DESC
    LIMIT 50
  `).all(req.principal.id);

  res.json({
    principal: { id: req.principal.id, name: req.principal.name },
    canManageRoster: req.householdRole === 'owner',
    members: members.map(serializeMember),
    instructions: instructions.map((i) => serializeInstruction(i)),
    counts: {
      staff: members.filter((m) => m.status === 'active').length,
      unacknowledged: instructions.filter((i) => i.status === 'open').length,
    },
  });
});

router.post('/:ownerId/staff', requireHouseholdOwner, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim().slice(0, 120);
  const jobTitle = String(req.body?.jobTitle || '').trim().slice(0, 60);

  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please provide a valid email address.' });
  if (!jobTitle) return res.status(400).json({ error: 'What is their role in the household?' });
  if (email === req.user.email) return res.status(400).json({ error: "You can't add yourself." });

  const clash = await db.prepare(`
    SELECT 1 FROM household_members WHERE owner_id = ? AND invited_email = ? AND status != 'revoked'
  `).get(req.principal.id, email);
  if (clash) return res.status(409).json({ error: 'They are already on your household list.' });

  const id = crypto.randomUUID();
  const token = crypto.randomBytes(24).toString('hex');
  const existingUser = await db.prepare('SELECT id, name FROM users WHERE email = ?').get(email);

  await db.prepare(`
    INSERT INTO household_members (id, owner_id, member_user_id, invited_email, name, job_title, status, invite_token, created_at)
    VALUES (?, ?, NULL, ?, ?, ?, 'invited', ?, ?)
  `).run(id, req.principal.id, email, name || existingUser?.name || '', jobTitle, token, new Date().toISOString());

  await sendEmail({
    ownerId: req.principal.id, toEmail: email, category: 'household_invite',
    subject: `${req.user.name} added you to their household on ${BRAND_FULL}`,
    body: `${req.user.name} added you as their ${jobTitle} on ${BRAND_FULL}.\n\n`
      + 'You will see what you have been asked to do, and can confirm you have it. '
      + 'You will not see their calendar, their contacts or anything else.\n\n'
      + `Accept: /accept-invite/${token}`,
  });

  const row = await db.prepare('SELECT * FROM household_members WHERE id = ?').get(id);
  res.status(201).json({ member: serializeMember(row), inviteLink: `/accept-invite/${token}` });
});

router.patch('/:ownerId/staff/:id', requireHouseholdOwner, async (req, res) => {
  const row = await db.prepare('SELECT * FROM household_members WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.principal.id);
  if (!row) return res.status(404).json({ error: 'Not on your household list.' });

  const { jobTitle, name } = req.body || {};
  if (jobTitle === undefined && name === undefined) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }
  if (jobTitle !== undefined) {
    if (!String(jobTitle).trim()) return res.status(400).json({ error: 'Give them a role.' });
    await db.prepare('UPDATE household_members SET job_title = ? WHERE id = ?')
      .run(String(jobTitle).trim().slice(0, 60), row.id);
  }
  if (name !== undefined) {
    await db.prepare('UPDATE household_members SET name = ? WHERE id = ?')
      .run(String(name).trim().slice(0, 120), row.id);
  }

  const updated = await db.prepare('SELECT * FROM household_members WHERE id = ? ').get(row.id);
  res.json({ member: serializeMember(updated) });
});

// Revoked, not deleted. What was asked of somebody, and whether they confirmed
// it, is exactly the record you want when a question comes up later — so the
// instructions survive their leaving, and only the access ends.
router.post('/:ownerId/staff/:id/revoke', requireHouseholdOwner, async (req, res) => {
  const row = await db.prepare('SELECT * FROM household_members WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.principal.id);
  if (!row) return res.status(404).json({ error: 'Not on your household list.' });
  await db.prepare("UPDATE household_members SET status = 'revoked' WHERE id = ?").run(row.id);
  res.status(204).end();
});

router.post('/:ownerId/instructions', requireHouseholdInstruct, async (req, res) => {
  const body = String(req.body?.body || '').trim();
  const memberId = String(req.body?.memberId || '');
  const dueAt = req.body?.dueAt ? new Date(req.body.dueAt) : null;

  if (!body) return res.status(400).json({ error: 'What should they do?' });
  if (dueAt && Number.isNaN(dueAt.getTime())) return res.status(400).json({ error: 'That time is not valid.' });

  const member = await db.prepare(`
    SELECT hm.*, u.email AS member_email
    FROM household_members hm
    LEFT JOIN users u ON u.id = hm.member_user_id
    WHERE hm.id = ? AND hm.owner_id = ? AND hm.status = 'active'
  `).get(memberId, req.principal.id);
  if (!member) return res.status(404).json({ error: 'That person is not on the household list.' });

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO household_instructions (id, owner_id, member_id, author_id, body, due_at, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
  `).run(id, req.principal.id, member.id, req.user.id, body.slice(0, 2000),
    dueAt ? dueAt.toISOString() : null, new Date().toISOString());

  // Emailed as well as shown in the app. Somebody driving a car is not
  // refreshing a dashboard, and an instruction that only exists on a screen
  // they are not looking at has not been given.
  await sendEmail({
    ownerId: req.principal.id, toEmail: member.member_email || member.invited_email,
    category: 'household_instruction',
    subject: `${req.user.name}: ${body.slice(0, 60)}${body.length > 60 ? '…' : ''}`,
    body: `${body}${dueAt ? `\n\nFor: ${dueAt.toISOString()}` : ''}\n\nConfirm you have it: /instructions`,
  });

  const row = await db.prepare(`
    SELECT i.*, u.name AS author_name, hm.name AS member_name, hm.job_title
    FROM household_instructions i
    JOIN household_members hm ON hm.id = i.member_id
    JOIN users u ON u.id = i.author_id
    WHERE i.id = ?
  `).get(id);
  res.status(201).json({ instruction: serializeInstruction(row) });
});

module.exports = router;
