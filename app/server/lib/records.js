// Words that file themselves.
//
// THE PROBLEM. A record in Kairos is formal: it has a status, it drives a
// stage, people work under it. Filing one is therefore a deliberate act, and
// the deliberate act is currently two taps in a menu — which means it mostly
// does not happen, and the decision trail an office is supposed to be able to
// produce a year later is a pile of ordinary messages nobody marked.
//
// WHY NOT INFER IT. The obvious build is to read the sentence and decide
// whether it sounds like a decision. That is wrong in the expensive direction:
// "I think we should approve the budget" is a musing, and filing it as an
// approval would put the office to work under something nobody agreed. A
// missed record is a nuisance; an invented one is a false record, and this
// product exists to be trusted about exactly that.
//
// SO: A MARKER, NOT A GUESS. Nobody types "Decision:" by accident. The word
// IS the intent — it is a command, in the way "TODO:" is a command in a
// mailbox — so acting on it is automatic without being presumptuous. Anything
// unmarked stays an ordinary message, and the app may OFFER to file it but
// never files it. The same line drawn for the assistant: never act, never
// pretend.
//
// THE MARKER IS CONSUMED. The filed record reads "we go with the Lekki site",
// not "Decision: we go with the Lekki site". Leaving it in gives every record
// in the archive a stutter, and the label is already on the row.

// Deliberately a small, closed list, and deliberately the SAME six types the
// record register already has — a vocabulary that names things the app cannot
// file would be a promise it does not keep.
//
// Several spellings per type because people do not share a house style, and a
// marker that only works when spelled the way the developer spelled it is a
// marker that teaches people it is unreliable.
const MARKERS = [
  { type: 'decision', words: ['decision', 'decided', 'agreed'] },
  { type: 'approval', words: ['approved', 'approval'] },
  { type: 'request', words: ['request', 'requested', 'ask'] },
  { type: 'update', words: ['update', 'noted'] },
  { type: 'sign_off', words: ['sign-off', 'sign off', 'signoff', 'signed off'] },
  { type: 'blocker', words: ['blocker', 'blocked'] },
];

// What a person is shown so this is learnable in one sighting rather than
// being folklore one assistant knows. Ordered as the composer shows them.
const VOCABULARY = MARKERS.map((m) => ({
  type: m.type,
  marker: `${m.words[0][0].toUpperCase()}${m.words[0].slice(1)}:`,
  alsoAccepts: m.words.slice(1),
}));

// Built once. The marker has to be at the very start and followed by a colon:
// "the blocker: nobody rang the surveyor" is a sentence about a blocker, not a
// filed one, and the difference is where the word sits.
const PATTERN = new RegExp(
  `^\\s*(${MARKERS.flatMap((m) => m.words)
    .sort((a, b) => b.length - a.length)   // longest first: "signed off" before "sign off"
    .map((w) => w.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'))
    .join('|')})\\s*:\\s*`,
  'i',
);

const TYPE_BY_WORD = new Map();
for (const m of MARKERS) for (const w of m.words) TYPE_BY_WORD.set(w.toLowerCase(), m.type);

/**
 * Read a marker off the front of a message, if there is one.
 *
 * Returns null for ordinary text — which is most text, and must stay cheap and
 * uneventful. Returns the record type and the message with the marker taken
 * off when one is found.
 *
 * REFUSES AN EMPTY REMAINDER. "Decision:" on its own is somebody who has not
 * finished typing, and filing a blank decision is worse than filing nothing:
 * it is a record in the register with no content, which somebody will have to
 * supersede rather than delete.
 */
function detect(text) {
  const raw = String(text || '');
  const found = raw.match(PATTERN);
  if (!found) return null;
  const body = raw.slice(found[0].length).trim();
  if (!body) return null;
  return { recordType: TYPE_BY_WORD.get(found[1].toLowerCase()), body };
}

module.exports = { detect, VOCABULARY, MARKERS };
