/**
 * Whether this deployment can reach a phone that is not open.
 *
 * Only the question, for now. Sending is the next piece of work and is
 * deliberately not here: it needs a subscriptions table and a sender, and
 * shipping half of it would leave a module that looks able to push and cannot.
 *
 * WHAT THE KEYS ARE. A push notification never travels from Kairos to a phone.
 * It goes to whichever push service that browser belongs to — Google's for
 * Chrome, Apple's for Safari — and those services carry nothing from a sender
 * they cannot identify. VAPID is that identity: ONE pair for the whole
 * deployment, used to sign every push, not one per person or per device.
 *
 * The subject travels with the signature so a push service has somebody to
 * complain to when a deployment misbehaves. It has to be a mailto: or an
 * https: URL; anything else is rejected at the far end rather than here, which
 * is exactly the sort of failure nobody can trace, so it is checked on the way
 * in instead.
 */

function publicKey() {
  return String(process.env.VAPID_PUBLIC_KEY || '').trim();
}

function privateKey() {
  return String(process.env.VAPID_PRIVATE_KEY || '').trim();
}

function subject() {
  return String(process.env.VAPID_SUBJECT || '').trim();
}

/**
 * Both halves present and the right shape.
 *
 * Lengths rather than a regex on the contents: a P-256 public key is the
 * uncompressed point — 65 bytes, so 87 base64url characters — and the private
 * half is the 32-byte scalar, so 43. Anything else was pasted wrong, and
 * saying so here beats a push service silently dropping every message.
 */
function isConfigured() {
  return publicKey().length === 87 && privateKey().length === 43 && !!subject();
}

/** What is wrong, in words, or null. For an operator, not for a principal. */
function problem() {
  if (!publicKey() && !privateKey() && !subject()) return null; // Simply not set up.
  if (publicKey().length !== 87) {
    return 'VAPID_PUBLIC_KEY should be 87 characters. Generate the pair again rather than editing it.';
  }
  if (privateKey().length !== 43) {
    return 'VAPID_PRIVATE_KEY should be 43 characters. Generate the pair again rather than editing it.';
  }
  if (!subject()) {
    return 'VAPID_SUBJECT is missing — an address the push services can complain to, like mailto:you@yourdomain.com.';
  }
  if (!/^(mailto:|https:\/\/)/.test(subject())) {
    return 'VAPID_SUBJECT must start with mailto: or https://.';
  }
  return null;
}

module.exports = { isConfigured, problem, publicKey, subject };
