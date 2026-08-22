// How a meeting actually happens, decided by the person asking for it.
//
// It used to be the principal's decision, fixed when they made the meeting
// type: every booking of "Intro call" was a video call because that is what
// the type said. But the person who knows whether video will do is the one
// travelling — a lawyer who needs to hand over documents, a banker who is in
// the building anyway, somebody on a train with no signal. They had no way to
// say so except to book and then email about it.
//
// So the booker chooses, and the office agrees. Two rules make that safe.
//
// TAKING THE USUAL FORMAT CHANGES NOTHING. A booker who accepts the format the
// principal already offers is treated exactly as before: Tier 1 and 2 land on
// the diary immediately, Tier 3 and 4 go to the approval queue. Asking for
// something different is what turns a booking into a request, whatever the
// tier — because that is the only case where somebody has to decide.
//
// THE OFFICE CAN ANSWER BACK. Accepting or declining is a poor pair of choices
// when the real answer is usually "not video, come in" — so the office can
// propose a different format and the booker accepts it or withdraws. That is
// how this conversation goes on the telephone, and there is no reason the app
// should be worse at it.

const FORMATS = {
  video: {
    label: 'Video call',
    hint: 'A link is created automatically.',
    needsNote: false,
  },
  in_person: {
    label: 'In person',
    hint: 'Where is decided between you.',
    needsNote: false,
  },
  phone: {
    label: 'Phone call',
    hint: 'Who calls whom is decided between you.',
    needsNote: false,
  },
  // The escape hatch, and the reason it exists: a fixed list is a guess about
  // every meeting anybody will ever ask for, and it will be wrong. Somebody
  // wants a site visit, a walk, a call on a specific platform the office uses.
  // Refusing that would push the conversation back to email, which is the
  // thing this feature exists to stop.
  other: {
    label: 'Something else',
    hint: 'Say what you have in mind.',
    needsNote: true,
  },
};

const IDS = Object.keys(FORMATS);

/** The three states a format can be in between the booker asking and it being settled. */
const STATES = {
  // Agreed: either it matches what the principal offers, or somebody said yes.
  agreed: 'agreed',
  // The booker asked for something other than the usual, nobody has answered.
  proposed: 'proposed',
  // The office answered with a different suggestion; the booker has not replied.
  countered: 'countered',
};

function isFormat(value) {
  return Object.prototype.hasOwnProperty.call(FORMATS, value);
}

function label(id) {
  return FORMATS[id]?.label || 'Not stated';
}

/**
 * Why this format and note are unusable, or null.
 *
 * Returns prose — every caller shows it to whoever typed it.
 */
function problem(format, note) {
  if (!format) return null;                 // Nothing chosen is fine; the default stands.
  if (!isFormat(format)) return 'That is not a way of meeting.';
  const text = String(note || '').trim();
  if (FORMATS[format].needsNote && !text) {
    return 'Say what you have in mind, so the office knows what is being asked for.';
  }
  if (text.length > 300) return 'Keep that under 300 characters.';
  return null;
}

/**
 * What the booker gets to choose from, for a given meeting type.
 *
 * Every format, always — the principal's own is marked as the usual one rather
 * than being the only one. A list that quietly omitted the others would be the
 * old behaviour wearing a menu.
 */
function offer(defaultFormat) {
  return IDS.map((id) => ({
    id,
    label: FORMATS[id].label,
    hint: FORMATS[id].hint,
    needsNote: FORMATS[id].needsNote,
    isUsual: id === defaultFormat,
  }));
}

/**
 * Does this choice need somebody to agree to it?
 *
 * Only when it differs from what the principal already offers. Choosing the
 * usual format is not a request and must not be treated as one.
 */
function needsAgreement(chosen, defaultFormat) {
  if (!chosen) return false;
  return chosen !== defaultFormat;
}

module.exports = { FORMATS, IDS, STATES, isFormat, label, problem, offer, needsAgreement };
