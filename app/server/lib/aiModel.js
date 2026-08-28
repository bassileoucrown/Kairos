const db = require('./db');

// The gate every model call goes through, and the rules it cannot get around.
//
// THERE IS NO MODEL IN THIS DEPLOYMENT UNTIL A KEY IS SET, and until then the
// honest answer is that a thing does not work — not a template dressed up as
// generation. lib/aiAssist.js matches keywords against eight fixed templates,
// which is a real feature and is not an assistant; calling its output "drafted"
// without saying so is the app taking credit for something it did not do, and
// a product that will mislead about that has no standing to be believed about
// what it does with a passport. So availability is computed from the same
// environment the caller reads, exactly as MAPS_API_KEY and the rest are, and
// the screens say which of the two they are showing.
//
// THE VAULT IS OFF-LIMITS, ENTIRELY. Not "redacted", not "masked" — nothing
// from essentials is ever assembled into a prompt, and no model output is ever
// written into one. Both directions matter and they fail differently:
//
//   OUTBOUND, a passport number in a prompt has left the building. It is in
//   somebody else's logs, and no later deletion reaches it. This is the single
//   thing that would end a custody business, and it is worth more than any
//   convenience it buys.
//
//   INBOUND, a model-supplied digit in a passport number is undetectable by
//   eye and catastrophic at a border. A vault entry has to come from a person
//   who held the document.
//
// AND IT IS A CODE PATH, NOT AN INSTRUCTION. A rule written into a system
// prompt is advice a model may or may not follow; a function that refuses is a
// guarantee. So the check lives here, in front of the send, and the tests
// prove it by trying.

const MODEL = 'claude-opus-5';

/** Whether this deployment can call a model at all. */
function isConfigured() {
  return !!(process.env.ANTHROPIC_API_KEY || '').trim();
}

/** What a screen should say when it cannot. */
const UNAVAILABLE = 'This needs a language model, and none is configured for this deployment.';

/**
 * Thrown when a request would put vault material in front of a model, or take
 * model output into the vault.
 *
 * A distinct error rather than a generic 400 because the two cases want
 * different words: an assistant who asked for a passport in a draft should be
 * told to fetch it themselves through the reveal — which costs a second
 * factor and is written to the log the principal reads — rather than being
 * handed a draft with a silent gap in it they might fill in by hand.
 */
class VaultRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = 'VaultRefusal';
    this.code = 'vault_off_limits';
  }
}

/** The words a refusal uses, in one place so every route refuses the same way. */
const REFUSAL = 'Kairos will not put anything from the vault in front of a language model, '
  + 'or take one\'s word for what a document says. Reveal the detail yourself and type it in — '
  + 'that route asks for a second factor and is recorded for the principal to see.';

// Field names and labels are enough to identify what is being asked for, and
// naming a category is not the same as leaking a value — but a REQUEST for one
// is refused all the same, because the useful thing to hand back is the reason
// rather than a draft with a hole in it.
//
// MATCHED ON WORD BOUNDARIES, NOT AS SUBSTRINGS, and the reason is Nigerian.
// A NIN is a real thing this vault holds and "nin" is three letters that sit
// inside "morning" — so a substring list refused "book him Tuesday morning" as
// an attempt to exfiltrate an identity number. Over-eager is the right way for
// this to fail; unusable is not, and a guard that blocks ordinary work is a
// guard somebody will find a way around.
const VAULT_WORDS = [
  'passport', 'visa number', 'national id', 'nin', 'bvn', 'voter', 'social security',
  'driving licence', 'driver licence', 'drivers licence', 'known traveller',
  'global entry', 'yellow fever', 'policy number', 'account number', 'card number',
  'tax identification', 'tin', 'loyalty number', 'frequent flyer',
];

const VAULT_RE = new RegExp(
  `\\b(${VAULT_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'i',
);

/**
 * Would this text have Kairos read out of the vault?
 *
 * Deliberately blunt. A false positive costs somebody a rephrase; a false
 * negative costs a principal their passport number, permanently, into
 * somebody else's logs. That asymmetry is the whole design, and it is why this
 * is a word list rather than anything cleverer — something cleverer would be a
 * thing that can be wrong in interesting ways.
 */
function asksForVault(text) {
  return VAULT_RE.test(String(text || ''));
}

/**
 * The last gate before a request reaches a model.
 *
 * Called with everything that would be sent — instruction, context, the lot —
 * so there is one place that can say no, rather than a check per caller that
 * one caller will eventually be written without.
 */
function refuseIfVault(...parts) {
  const joined = parts.filter(Boolean).join('\n');
  if (asksForVault(joined)) throw new VaultRefusal(REFUSAL);
  return joined;
}

/**
 * Everything Kairos holds about a principal that a model MAY see.
 *
 * Written as a positive list rather than as "everything except essentials",
 * and that is the point: a denylist is a promise to remember, every time a
 * table is added, that the new one might be sensitive. This is the opposite —
 * a table has to be named here before a model can ever see it, so the default
 * for anything added later is silence.
 */
const READABLE = Object.freeze(['messages', 'bookings', 'contacts', 'tasks', 'briefs']);

/** True only for a table that has been deliberately admitted above. */
function mayRead(table) {
  return READABLE.includes(table);
}

/**
 * A principal's own recent words, for grounding a draft in how they write.
 *
 * THIS IS WHAT MAKES A DRAFT NOT SOUND GENERIC, and it is worth saying why it
 * is not a prompt instruction. Telling a model to "sound human" produces the
 * average of everybody; showing it six things this person actually wrote
 * produces this person. Somebody who writes three lines with no greeting gets
 * back three lines with no greeting.
 *
 * Messages only — never a vault entry, never a document. See READABLE.
 */
async function voiceSample(userId, limit = 6) {
  const rows = await db.prepare(`
    SELECT m.body FROM messages m
    WHERE m.author_id = ? AND m.body IS NOT NULL AND m.body != ''
    ORDER BY m.created_at DESC LIMIT ?
  `).all(userId, limit);
  return rows.map((r) => r.body);
}

module.exports = {
  MODEL, isConfigured, UNAVAILABLE, REFUSAL,
  VaultRefusal, asksForVault, refuseIfVault, mayRead, READABLE, voiceSample,
};
