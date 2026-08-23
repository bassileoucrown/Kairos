// How a meeting actually happens, decided by the person asking for it.
//
// It used to be the principal's decision, fixed when they made the meeting
// type: every booking of "Intro call" was a video call because that is what
// the type said. But the person who knows whether video will do is the one
// travelling — a lawyer who needs to hand over documents, a banker who is in
// the building anyway, somebody on a train with no signal. They had no way to
// say so except to book and then email about it.
//
// So the booker chooses, and the choice stands. Two rules make that safe.
//
// THE BOOKER'S CHOICE IS ALLOWED. Whatever they pick is the format, agreed on
// arrival. It does not hold the booking and it does not turn a booking into a
// request — the access tier alone decides that, exactly as it did before
// formats existed. Tier 1 and 2 land on the diary; Tier 3 and 4 go to the
// approval queue; and in both cases the format is simply what was asked for.
//
// This was the other way round at first: choosing anything other than the
// principal's usual format held the booking until somebody agreed. That made a
// menu out of a question already answered — it offered four ways to meet and
// then treated three of them as an imposition, so a Tier 1 booking that would
// have been instant became pending because somebody preferred the telephone.
//
// THE OFFICE CAN STILL ANSWER BACK. What replaces the gate is a suggestion:
// the office may propose a different format, and then the booker accepts it or
// withdraws. That is how the conversation goes on the telephone — you do not
// refuse to hold the appointment until the room is settled, you take it and
// say "actually, come in" — and there is no reason the app should be worse
// at it.

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
 * Is this a departure from what the principal usually offers?
 *
 * For saying so, and nothing else. This used to decide whether a booking was
 * held — it no longer does, and it must not be given that job again, because
 * the booker's choice is allowed. The office is still told, since an assistant
 * reading an approval needs to see that this "Intro call" is in person before
 * they answer it; being told is not the same as being asked.
 */
function isDeparture(chosen, defaultFormat) {
  if (!chosen) return false;
  return chosen !== defaultFormat;
}

module.exports = { FORMATS, IDS, STATES, isFormat, label, problem, offer, isDeparture };
