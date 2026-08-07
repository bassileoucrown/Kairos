const express = require('express');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { isConfigured: calendarConfigured } = require('../lib/calendarSync');
const { isConfigured: whatsappConfigured } = require('../lib/whatsapp');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM calendar_connections WHERE owner_id = ?').all(req.user.id);
  const byProvider = Object.fromEntries(rows.map((r) => [r.provider, r]));
  const wa = db.prepare('SELECT * FROM whatsapp_connections WHERE owner_id = ?').get(req.user.id);

  res.json({
    calendar: {
      google: {
        status: byProvider.google?.status || 'disconnected',
        configured: calendarConfigured('google'),
      },
      outlook: {
        status: byProvider.outlook?.status || 'disconnected',
        configured: calendarConfigured('outlook'),
      },
    },
    whatsapp: {
      status: wa?.status || 'disconnected',
      phoneNumber: wa?.phone_number || null,
      configured: whatsappConfigured(),
    },
  });
});

router.post('/calendar/:provider/connect', (req, res) => {
  const { provider } = req.params;
  if (!['google', 'outlook'].includes(provider)) {
    return res.status(400).json({ error: 'Unknown calendar provider.' });
  }
  if (!calendarConfigured(provider)) {
    return res.status(501).json({
      error: `${provider === 'google' ? 'Google' : 'Outlook'} Calendar sync isn't configured on this deployment yet — it needs OAuth client credentials set as environment variables. The architecture is in place (see server/lib/calendarSync.js); this just needs a real client ID and secret to go live.`,
    });
  }
  // Configured but not yet wired up — see lib/calendarSync.js.
  res.status(501).json({ error: 'Credentials are configured, but the OAuth exchange itself is not implemented yet.' });
});

router.delete('/calendar/:provider', (req, res) => {
  db.prepare('DELETE FROM calendar_connections WHERE owner_id = ? AND provider = ?').run(req.user.id, req.params.provider);
  res.status(204).end();
});

router.post('/whatsapp/connect', (req, res) => {
  if (!whatsappConfigured()) {
    return res.status(501).json({
      error: "WhatsApp notifications aren't configured on this deployment yet — it needs a WhatsApp Business API token set as an environment variable. The architecture is in place (see server/lib/whatsapp.js); this just needs a real business account to go live.",
    });
  }
  res.status(501).json({ error: 'Credentials are configured, but the send integration itself is not implemented yet.' });
});

router.delete('/whatsapp', (req, res) => {
  db.prepare('DELETE FROM whatsapp_connections WHERE owner_id = ?').run(req.user.id);
  res.status(204).end();
});

module.exports = router;
