const crypto = require('crypto');
const db = require('./db');

// Everything Kairos talks to, in one list.
//
// This exists because the same shape had already been written twice —
// lib/calendarSync.js and lib/whatsapp.js are both "is it configured on this
// deployment, has this account connected it, refuse honestly until both" — and
// the third one is where a repeated shape becomes a pattern worth naming.
//
// TWO KINDS, AND THEY BEHAVE NOTHING ALIKE
//
// A DEPLOYMENT connector is configured once, by whoever runs Kairos, and no
// principal ever sees a button for it. Flight data, object storage, the
// transcription route: they are either on for everybody or off for everybody,
// and when they are off the honest answer is "not configured here".
//
// An ACCOUNT connector is connected by each principal, to their own thing.
// Their Google Calendar, their WhatsApp number, their Zoom. Two states have to
// be true before it works — configured on the deployment AND connected by this
// account — and telling those two apart is the difference between "we haven't
// built this yet" and "you haven't finished setting it up", which are very
// different sentences to read.
//
// WHAT IS NOT HERE
//
// Paystack and Flutterwave. Billing is not a connector: nobody connects it,
// it has no per-account state, and putting it on a screen beside Google
// Calendar would suggest a principal could turn their own subscription off.
//
// Identity verification (BVN and NIN checks through VerifyMe, Smile ID and the
// like) is deliberately absent too, and that one is a judgement rather than an
// omission. It would make the vault more useful — a BVN confirmed against a
// name is worth more than a BVN typed in. It would also mean sending a
// principal's BVN to a third party, which is the exact opposite of what this
// vault promises. If it is ever added it belongs behind an explicit,
// per-document consent, never as a background check, and it is not being
// slipped into a registry of conveniences.

const CONNECTORS = [
  // ---- Calendars ----
  {
    id: 'google_calendar',
    label: 'Google Calendar',
    what: 'Reads the busy time already in your calendar so Kairos never offers a slot you cannot take, and writes bookings back out.',
    kind: 'account',
    plan: 'standard',
    env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  },
  {
    id: 'outlook_calendar',
    label: 'Outlook Calendar',
    what: 'The same two-way sync through Microsoft Graph, for an office that lives in Outlook.',
    kind: 'account',
    plan: 'standard',
    env: ['MS_CLIENT_ID', 'MS_CLIENT_SECRET'],
  },
  {
    id: 'calendar_feed',
    label: 'Calendar subscription',
    what: 'A private read-only link your phone can subscribe to, so Kairos appears in Apple Calendar or anything else without connecting an account. Cheap, universal, and works where OAuth does not.',
    kind: 'account',
    plan: 'free',
    env: [],
  },
  {
    id: 'caldav',
    label: 'Apple Calendar (CalDAV)',
    what: 'Two-way with iCloud, for a principal whose diary has never been anywhere but an iPhone.',
    kind: 'account',
    plan: 'standard',
    env: ['CALDAV_ENABLED'],
  },

  // ---- Messaging ----
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    what: 'Confirmations, reminders and the direct line on the channel this market actually reads, rather than an email nobody opens.',
    kind: 'account',
    plan: 'standard',
    env: ['WHATSAPP_BUSINESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
  },
  {
    id: 'sms',
    label: 'SMS fallback',
    what: 'For the people who make a day work and do not live in an app — a driver who needs the pickup card as a text, not a link in a chat they never open.',
    kind: 'deployment',
    plan: 'executive',
    env: ['SMS_PROVIDER_KEY'],
  },
  {
    id: 'mailbox',
    label: 'Send from your own address',
    what: 'Invitations that arrive from the principal\'s own domain instead of ours. A board member replies to office@theirbank.com and ignores noreply@.',
    kind: 'account',
    plan: 'plus',
    env: ['GOOGLE_CLIENT_ID', 'MS_CLIENT_ID'],
  },
  {
    id: 'inbound_email',
    label: 'Forward a confirmation',
    what: 'Forward an airline or hotel confirmation to your trips address and the journey builds itself — flight, times, terminal, reference — instead of being retyped from a PDF.',
    kind: 'deployment',
    plan: 'plus',
    env: ['INBOUND_EMAIL_DOMAIN', 'INBOUND_EMAIL_SECRET'],
  },

  // ---- Meetings ----
  {
    id: 'zoom',
    label: 'Zoom',
    what: 'Real Zoom links on video meeting types, for counterparties who will not click anything else.',
    kind: 'account',
    plan: 'plus',
    env: ['ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'],
  },
  {
    id: 'teams',
    label: 'Microsoft Teams',
    what: 'The same, for the institutions that have standardised on it.',
    kind: 'account',
    plan: 'plus',
    env: ['MS_CLIENT_ID', 'MS_CLIENT_SECRET'],
  },

  // ---- The day ----
  {
    id: 'maps',
    label: 'Travel time with live traffic',
    what: 'Journey times between two things on the day, at the hour they actually happen. In Lagos the difference between 20 minutes and 90 is the whole schedule, and travel_minutes is typed by hand today.',
    kind: 'deployment',
    plan: 'plus',
    env: ['MAPS_API_KEY'],
  },
  {
    id: 'flights',
    label: 'Live flight status',
    what: 'The flight as it is rather than as it was booked, feeding the delay cascade so the car is told the truth.',
    kind: 'deployment',
    plan: 'plus',
    env: ['FLIGHT_DATA_KEY'],
  },
  {
    id: 'rides',
    label: 'Ride-hailing',
    what: 'When the arrangement is "making their own way", a car ordered to the right place at the right time from Uber or Bolt, rather than a decision recorded and then improvised.',
    kind: 'account',
    plan: 'plus',
    env: ['RIDES_PARTNER_KEY'],
  },
  {
    id: 'contacts_sync',
    label: 'Contacts',
    what: 'The four thousand people already in a phone, so the relationship calendar knows whose birthday is on Thursday without anybody typing it in.',
    kind: 'account',
    plan: 'standard',
    env: ['GOOGLE_CLIENT_ID', 'MS_CLIENT_ID'],
  },

  // ---- Infrastructure ----
  {
    id: 'storage',
    label: 'Document storage',
    what: 'Where a scanned passport page is kept, encrypted, when the number alone is not enough.',
    kind: 'deployment',
    plan: 'plus',
    env: ['STORAGE_BUCKET', 'STORAGE_KEY'],
  },
  {
    id: 'transcription',
    label: 'Voice transcription',
    what: 'Voice notes made searchable, through a route that does not hand a principal\'s audio to somebody else.',
    kind: 'deployment',
    plan: 'executive',
    env: ['TRANSCRIPTION_ENDPOINT', 'TRANSCRIPTION_KEY'],
  },
  {
    id: 'sso',
    label: 'Single sign-on',
    what: 'Entra, Okta or Google Workspace, so an executive who joins or leaves the institution is provisioned with everyone else rather than by hand.',
    kind: 'account',
    plan: 'enterprise',
    env: ['SSO_ISSUER', 'SSO_CLIENT_ID'],
  },
];

const BY_ID = new Map(CONNECTORS.map((c) => [c.id, c]));

function get(id) {
  return BY_ID.get(id) || null;
}

/**
 * Whether this deployment has what the connector needs.
 *
 * A connector with no env at all is configured by definition — the calendar
 * subscription link needs nothing but a random token, and pretending it needs
 * setting up would be inventing a barrier to look consistent.
 */
function isConfigured(id) {
  const c = get(id);
  if (!c) return false;
  if (!c.env.length) return true;
  return c.env.every((name) => Boolean(process.env[name]));
}

/** Which accounts have connected what. One query, not one per connector. */
async function connectionsFor(ownerId) {
  const rows = await db.prepare(
    'SELECT connector_id, status, account_label FROM connector_connections WHERE owner_id = ?',
  ).all(ownerId);
  return new Map(rows.map((r) => [r.connector_id, r]));
}

/**
 * The catalogue as one account sees it.
 *
 * `configured` and `connected` are reported separately and never collapsed
 * into one "available" flag, because the two produce different sentences: one
 * is our work outstanding, the other is theirs.
 */
async function listFor(ownerId, { allows } = {}) {
  const connections = await connectionsFor(ownerId);
  return CONNECTORS.map((c) => {
    const conn = connections.get(c.id);
    return {
      id: c.id,
      label: c.label,
      what: c.what,
      kind: c.kind,
      plan: c.plan,
      configured: isConfigured(c.id),
      connected: conn?.status === 'connected',
      accountLabel: conn?.account_label || '',
      includedInPlan: allows ? allows(c.plan) : true,
      // Named so an operator reading /api/connectors knows what to go and set,
      // without reading the source. Names only — never values.
      needs: c.env,
    };
  });
}

async function connect(ownerId, id, label = '') {
  const now = new Date().toISOString();
  const existing = await db.prepare(
    'SELECT id FROM connector_connections WHERE owner_id = ? AND connector_id = ?',
  ).get(ownerId, id);
  if (existing) {
    await db.prepare('UPDATE connector_connections SET status = ?, account_label = ? WHERE id = ?')
      .run('connected', label, existing.id);
    return;
  }
  await db.prepare(`
    INSERT INTO connector_connections (id, owner_id, connector_id, status, account_label, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), ownerId, id, 'connected', label, now);
}

async function disconnect(ownerId, id) {
  await db.prepare('DELETE FROM connector_connections WHERE owner_id = ? AND connector_id = ?')
    .run(ownerId, id);
}

module.exports = { CONNECTORS, get, isConfigured, listFor, connect, disconnect };
