const crypto = require('crypto');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const webPush = require('../lib/webPush');

/**
 * Saying yes to being interrupted, and taking it back.
 *
 * PERMISSION IS THE BROWSER'S TO GIVE, NOT KAIROS'S TO ASK FOR TWICE. The
 * browser shows the prompt, the browser mints the subscription, and this
 * endpoint only records what came back. That is why there is nothing here that
 * resembles a "turn on notifications" flag: the browser's permission IS the
 * setting, and a second one kept in the database would be a second answer to
 * one question, free to disagree with the first. Revoking in the browser and
 * finding Kairos still claiming to be on is exactly that disagreement.
 *
 * A DEVICE, NOT A PERSON. Each browser on each device has its own subscription,
 * and all of them ring. An assistant who left their desk is who a push is for.
 */
const router = asyncRouter();

/**
 * What the browser needs before it can subscribe, and whether it is worth
 * asking. Public key only — the private half never leaves the server, which is
 * the entire security property VAPID provides.
 *
 * Answered even when unconfigured, with `configured: false`, so the screen can
 * say "this deployment cannot reach a phone" instead of offering a button that
 * fails.
 */
router.get('/config', requireAuth, async (req, res) => {
  res.json({
    configured: webPush.isConfigured(),
    publicKey: webPush.isConfigured() ? webPush.publicKey() : null,
    // Operator-facing, and only when something is half-set. A principal never
    // sees this because a correctly configured deployment has nothing to say.
    problem: webPush.problem(),
    devices: (await db.prepare(
      'SELECT id, user_agent, created_at, last_ok_at FROM push_subscriptions WHERE user_id = ? ORDER BY created_at',
    ).all(req.user.id)).map((d) => ({
      id: d.id, userAgent: d.user_agent, createdAt: d.created_at, lastOkAt: d.last_ok_at,
    })),
  });
});

router.post('/subscribe', requireAuth, async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'That is not a complete subscription.' });
  }
  // A push endpoint is a URL at somebody else's push service. Anything that is
  // not https is either a mistake or an attempt to make the server post
  // somewhere it should not.
  let url;
  try { url = new URL(endpoint); } catch { url = null; }
  if (!url || url.protocol !== 'https:') {
    return res.status(400).json({ error: 'A push endpoint must be an https address.' });
  }

  // The browser hands back the SAME endpoint every time it is asked, so
  // re-granting permission has to update the row. Inserting again would leave
  // two rows for one device and push to it twice.
  //
  // Written as delete-then-insert rather than an upsert because the two
  // backends spell upsert differently, and one statement that works on both is
  // worth more here than one round trip saved.
  await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  await db.prepare(`
    INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), req.user.id, endpoint,
    String(keys.p256dh), String(keys.auth),
    String(req.get('user-agent') || '').slice(0, 300),
    new Date().toISOString(),
  );

  res.status(201).json({ ok: true });
});

/**
 * Not this device any more.
 *
 * Scoped to the caller's own rows: an endpoint is not a secret worth much, but
 * being able to silence somebody else's phone by knowing theirs would be a
 * genuinely nasty little hole.
 */
router.delete('/subscribe', requireAuth, async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'Say which subscription.' });
  await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
    .run(endpoint, req.user.id);
  res.status(204).end();
});

/**
 * Ring my own phone.
 *
 * Worth having as a real endpoint rather than a debug aid. Push is the one
 * feature in Kairos whose failure is completely silent — a misconfigured pair,
 * a revoked permission, a subscription the browser rotated — and "nothing has
 * arrived" is indistinguishable from "nothing has happened". This is how
 * somebody finds out which.
 */
router.post('/test', requireAuth, async (req, res) => {
  if (!webPush.isConfigured()) {
    return res.status(503).json({
      error: webPush.problem() || 'This deployment has no push keys, so it cannot reach a phone.',
    });
  }
  const { sent } = await webPush.notify(req.user.id, {
    title: 'Kairos',
    body: 'This is what an alert will look like.',
    url: '/today',
    tag: 'kairos-test',
  });
  res.json({
    sent,
    // Said plainly, because zero is the interesting answer and it has a
    // specific cause: this browser never granted permission, or the grant was
    // withdrawn and the subscription has just been swept.
    message: sent > 0
      ? `Sent to ${sent === 1 ? 'this device' : `${sent} devices`}.`
      : 'Nothing to send to — no device on this account has granted permission yet.',
  });
});

module.exports = router;
