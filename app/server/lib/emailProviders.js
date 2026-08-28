// Which service actually puts an email on the wire.
//
// One shape, two implementations, because the choice of provider is an
// operator's decision and not an architectural one. Whoever stands Kairos up
// may already have a SendGrid account, or may find Resend easier to verify a
// domain with, and neither should mean editing code.
//
// Both are HTTP APIs taking an API key, so the differences are small and
// entirely in the details that break silently: SendGrid answers 202 rather
// than 200 and returns an empty body, and reports failures as
// `{ errors: [{ message }] }` where Resend uses `{ message }`. Reading the
// wrong one turns a legible rejection into an empty string in the Outbox,
// which is the failure the delivery-status work exists to prevent.

const PROVIDERS = {
  resend: {
    label: 'Resend',
    keyVar: 'RESEND_API_KEY',
    endpoint: () => process.env.RESEND_ENDPOINT || 'https://api.resend.com/emails',
    headers: (key) => ({
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    }),
    body: ({ from, to, subject, text }) => JSON.stringify({ from, to, subject, text }),
    // Resend accepts 200 with the created message.
    accepts: (status) => status >= 200 && status < 300,
    errorMessage: (detail) => {
      try { return JSON.parse(detail).message || detail; }
      catch { return detail; }
    },
  },

  sendgrid: {
    label: 'SendGrid',
    keyVar: 'SENDGRID_API_KEY',
    endpoint: () => process.env.SENDGRID_ENDPOINT || 'https://api.sendgrid.com/v3/mail/send',
    headers: (key) => ({
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    }),
    // SendGrid's shape is more elaborate than it needs to be for one plain
    // message, and `from` must be an object rather than a string.
    body: ({ from, to, subject, text }) => JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: parseFrom(from),
      subject,
      content: [{ type: 'text/plain', value: text }],
    }),
    // 202 Accepted, with no body at all, is SendGrid's success.
    accepts: (status) => status >= 200 && status < 300,
    errorMessage: (detail) => {
      try {
        const parsed = JSON.parse(detail);
        const first = parsed.errors?.[0];
        return first ? [first.message, first.field].filter(Boolean).join(' — ') : detail;
      } catch { return detail; }
    },
  },
};

/**
 * Splits `Kairos <hello@example.com>` into SendGrid's object form. A bare
 * address passes through with no name, which is valid.
 */
function parseFrom(from) {
  const match = /^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/.exec(String(from || ''));
  if (match) return { email: match[2], name: match[1] || undefined };
  return { email: String(from || '').trim() };
}

/**
 * The provider this deployment will use, or null when none is configured.
 *
 * EMAIL_PROVIDER settles it when more than one key is present. Otherwise
 * whichever key exists wins, so setting a single variable is enough and an
 * operator never has to know this file exists.
 */
function activeProvider(env = process.env) {
  const named = String(env.EMAIL_PROVIDER || '').trim().toLowerCase();
  if (named) {
    const provider = PROVIDERS[named];
    if (!provider) {
      throw new Error(
        `EMAIL_PROVIDER is "${named}", which is not a provider Kairos knows. `
        + `Use one of: ${Object.keys(PROVIDERS).join(', ')}.`,
      );
    }
    const key = env[provider.keyVar];
    if (!key) {
      throw new Error(
        `EMAIL_PROVIDER is "${named}" but ${provider.keyVar} is not set, `
        + 'so nothing can be sent. Set the key, or unset EMAIL_PROVIDER.',
      );
    }
    return { name: named, key, ...provider };
  }

  for (const [name, provider] of Object.entries(PROVIDERS)) {
    const key = env[provider.keyVar];
    if (key) return { name, key, ...provider };
  }
  return null;
}

/** Whether mail will actually leave the building. Safe to call anywhere. */
function isConfigured(env = process.env) {
  try { return !!activeProvider(env); }
  // A misconfiguration is not "configured", and this is called from the status
  // endpoint where throwing would take down the one page that explains it.
  catch { return false; }
}

// Senders that a provider will accept a key for and then refuse to deliver
// from, except back to the account holder.
//
// WHY THIS DESERVES ITS OWN CHECK. Resend's shared address works the moment a
// key is set, which is exactly what makes it dangerous: the key is valid, the
// provider is reachable, mail to your own inbox arrives, and every message to
// anybody else is rejected. So the app said "email delivery configured" while
// no invitation could reach a single tester — true of the credential and false
// of the thing anybody cared about. Reported now as its own state, because a
// status screen that is technically right and practically wrong is worse than
// one that says nothing.
const SHARED_TEST_SENDERS = ['resend.dev', 'sendgrid.net'];

/**
 * Configured, and able to reach somebody other than the operator.
 *
 * Returns { configured, canReachAnyone, from, reason } so /api/status can say
 * which of the two it is rather than collapsing them into one boolean.
 */
function deliveryState(env = process.env) {
  const configured = isConfigured(env);
  const from = env.EMAIL_FROM || '';
  if (!configured) {
    return {
      configured: false,
      canReachAnyone: false,
      from: from || null,
      reason: 'No email provider is configured, so nothing is sent. Messages are still recorded in the Outbox.',
    };
  }
  const domain = (from.match(/@([^\s>]+)/) || [])[1] || '';
  const shared = !from || SHARED_TEST_SENDERS.some((d) => domain.toLowerCase().endsWith(d));
  if (shared) {
    return {
      configured: true,
      canReachAnyone: false,
      from: from || null,
      reason: 'Sending from the provider\'s shared test address, which only reaches the account '
        + 'holder\'s own inbox — everyone else is rejected. Verify a domain with the provider and '
        + 'set EMAIL_FROM to an address at it.',
    };
  }
  return { configured: true, canReachAnyone: true, from, reason: null };
}

module.exports = { PROVIDERS, activeProvider, isConfigured, deliveryState, parseFrom };
