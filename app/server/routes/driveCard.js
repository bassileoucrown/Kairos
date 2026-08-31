const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const enRoute = require('../lib/enRoute');
const { knock } = require('../lib/knock');

// The card the person driving holds. No account, no password.
//
// WHY THIS ROUTER IS SEPARATE AND HAS NO requireAuth. A driver is not a user
// of Kairos and never will be — asking a household driver to hold an account,
// a password and a second factor to say "we have arrived" is asking for the
// feature not to be used. The token in the URL is the whole credential, the
// same trade lib/pickup.js already makes for an arrivals-hall card.
//
// THAT TRADE IS ONLY SAFE BECAUSE THE CARD IS THIN. It carries no name, no
// escort, no convoy and no notes — see cardFor in lib/enRoute.js. A link
// forwarded to the wrong phone shows a journey between two places in a car
// with a plate, and nothing that says whose journey it is.
//
// AND IT CLOSES THE LOOP. The alarm in lib/reminders.js fires because nobody
// pressed arrived. The person who actually knows is the driver, and until this
// existed they had no way to say so — which meant the alarm was destined to
// fire on journeys that had gone perfectly.

const router = asyncRouter();

/** Everybody the office would tell about this journey. One rule, used twice. */
async function audienceFor(m) {
  const grantees = await db.prepare(`
    SELECT DISTINCT grantee_user_id AS id FROM movement_grants
     WHERE movement_id = ? AND revoked_at IS NULL AND expires_at > ?
  `).all(m.id, new Date().toISOString());
  return [...new Set([m.owner_id, m.arranged_by, ...grantees.map((g) => g.id)].filter(Boolean))];
}

router.get('/:token', async (req, res) => {
  const card = await enRoute.cardFor(req.params.token);
  // A wrong token and an expired one answer identically. Anything else tells
  // somebody holding a guess whether they guessed a real journey.
  if (!card) return res.status(404).json({ error: 'This card is not live.' });
  res.json({ card });
});

router.post('/:token/checks/:checkId', async (req, res) => {
  const card = await enRoute.cardFor(req.params.token);
  if (!card) return res.status(404).json({ error: 'This card is not live.' });
  const own = await db.prepare('SELECT id FROM movement_checks WHERE id = ? AND movement_id = ?')
    .get(req.params.checkId, card.movementId);
  if (!own) return res.status(404).json({ error: 'Not found.' });
  // No userId: nobody signed in did this, and recording the office's last
  // reader as the person who confirmed would be a lie on a safety record.
  await enRoute.confirmCheck(req.params.checkId, { userId: null, note: req.body?.note });
  res.json({ card: await enRoute.cardFor(req.params.token) });
});

router.post('/:token/arrived', async (req, res) => {
  const card = await enRoute.cardFor(req.params.token);
  if (!card) return res.status(404).json({ error: 'This card is not live.' });
  const m = await db.prepare('SELECT * FROM movements WHERE id = ?').get(card.movementId);
  if (m.arrived_at) return res.json({ card });
  await db.prepare('UPDATE movements SET arrived_at = ? WHERE id = ?')
    .run(new Date().toISOString(), m.id);
  res.json({ card: await enRoute.cardFor(req.params.token) });
});

/**
 * Something is wrong.
 *
 * TOLD IMMEDIATELY, not at the next sweep. Everything else about a journey is
 * noticed within ten minutes by lib/reminders.js. Ten minutes is the wrong
 * number for this one.
 *
 * NOT REVERSIBLE FROM HERE. A signal that the same phone can withdraw is a
 * signal an attacker withdraws. Standing it down needs somebody signed in, and
 * the fact that it was raised stays on the record either way.
 */
router.post('/:token/duress', async (req, res) => {
  const card = await enRoute.cardFor(req.params.token);
  if (!card) return res.status(404).json({ error: 'This card is not live.' });
  const m = await db.prepare('SELECT * FROM movements WHERE id = ?').get(card.movementId);

  const result = await enRoute.raiseDuress(m, { byUserId: null, note: req.body?.note });
  if (!result.already) {
    // The movement's own audience, as everywhere else — the principal, whoever
    // arranged it, and anybody covering. Not the wider office: this is the
    // most sensitive thing the product will ever say about a person.
    for (const toUserId of await audienceFor(m)) {
      await knock({
        toUserId,
        ownerId: m.owner_id,
        author: null,
        subject: `URGENT — something is wrong on ${m.title}`,
        line: `The car on "${m.title}" has signalled that something is wrong. `
          + `Ring the driver now.`,
        url: '/movements',
        category: 'movement_duress',
      });
    }
  }
  // The card says nothing back beyond that it was received. A screen that
  // reported "we have told four people" to whoever is holding the phone is
  // telling the wrong person about the office.
  res.json({ ok: true });
});

module.exports = { router };
