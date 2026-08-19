const crypto = require('crypto');
const db = require('./db');

// Visas: the part that can be answered truthfully, and the part that cannot.
//
// "Visa requirements" is two questions wearing one name, and they are not
// equally safe to answer.
//
//   COVERAGE — "does the visa I hold cover this trip?" Deterministic, from
//   facts the principal supplied: a Schengen multi-entry valid to March, a
//   single-entry US visa already used in January, a UK visa that expires four
//   days before the return flight. Nothing has to be looked up. Being wrong is
//   impossible in a way that matters, because the inputs are the principal's
//   own documents. This is built.
//
//   REQUIREMENT — "does a Nigerian passport need a visa for Kenya?" That is
//   forty thousand nationality-by-destination pairs, revised by governments
//   without notice, where a wrong "no visa needed" strands somebody at a
//   check-in desk with a boarding pass they cannot use. It is not guessable
//   and it is not scrapeable responsibly. It stays a provider adapter,
//   unconfigured, and the screen says so. See ruleProvider below.
//
// The distinction is the whole design. Answering the first well is most of the
// value — an assistant already knows Nigerians need a UK visa, and what they
// cannot hold in their head is whether the one in the drawer still works for
// the trip in March.
//
// WHERE THE NUMBER LIVES: not here. A visa number is sensitive and the vault
// already has custody rules, encryption and a second factor for exactly that
// class of thing. This table holds the SHAPE of a visa — country, type,
// entries, dates — which is what coverage reasons about, and links to the
// vault entry if somebody recorded the number. One sensitive datum, one place
// that guards it.

const KINDS = {
  single: { label: 'Single entry', entries: 1 },
  double: { label: 'Double entry', entries: 2 },
  multi: { label: 'Multiple entry', entries: null },
  transit: { label: 'Transit', entries: 1 },
  evisa: { label: 'e-Visa', entries: 1 },
  on_arrival: { label: 'On arrival', entries: 1 },
  visa_free: { label: 'No visa needed', entries: null },
};

function isKind(k) { return Object.prototype.hasOwnProperty.call(KINDS, k); }

// Typical processing time, in working days, for a Nigerian applicant.
//
// GUIDANCE, and labelled as guidance everywhere it is shown. It is here
// because an assistant with no anchor at all starts a US application in March
// for a June trip, and the appointment itself is months out — a rough number
// is the difference between starting and not. It is deliberately NOT a rule
// about whether a visa is needed: being a week out on a lead time costs a
// nudge, being wrong about a requirement costs the trip.
//
// Stamped with the date it was last reviewed so staleness is visible rather
// than invisible. Whoever updates it should move the date.
const PROCESSING_REVIEWED = '2026-08-19';
const PROCESSING_DAYS = {
  'United States': { days: 90, note: 'The interview appointment is the long pole, not the decision.' },
  'United Kingdom': { days: 20, note: 'Priority services exist and cost more.' },
  Schengen: { days: 20, note: 'Apply to the country you will spend most nights in.' },
  Canada: { days: 60 },
  China: { days: 10 },
  India: { days: 10, note: 'e-Visa is usually faster than the paper route.' },
  'United Arab Emirates': { days: 5, note: 'Often arranged by the airline or hotel.' },
  'South Africa': { days: 15 },
  Kenya: { days: 5, note: 'Electronic travel authorisation.' },
  Ghana: { days: 7 },
  Turkey: { days: 5 },
  Egypt: { days: 7 },
  Japan: { days: 10 },
  Australia: { days: 30 },
};

/** A destination's typical lead time, if we have any idea. */
function processingFor(country) {
  const key = Object.keys(PROCESSING_DAYS)
    .find((k) => k.toLowerCase() === String(country || '').trim().toLowerCase());
  if (!key) return null;
  return { country: key, ...PROCESSING_DAYS[key], reviewedOn: PROCESSING_REVIEWED };
}

/**
 * Whether a rules source is configured for "does this passport need a visa".
 *
 * Nothing here guesses. Until a provider is set the answer is "we do not know",
 * which is the only honest thing an unconfigured deployment can say about a
 * question that strands people when it is answered wrongly.
 */
function rulesConfigured() {
  return Boolean(process.env.VISA_RULES_KEY);
}

async function listFor(ownerId) {
  const rows = await db.prepare(
    'SELECT * FROM visas WHERE owner_id = ? ORDER BY valid_to IS NULL, valid_to ASC',
  ).all(ownerId);
  return rows.map(serialize);
}

function serialize(r) {
  return {
    id: r.id,
    country: r.country,
    kind: r.kind,
    kindLabel: KINDS[r.kind]?.label || r.kind,
    entriesTotal: r.entries_total,
    entriesUsed: Number(r.entries_used || 0),
    validFrom: r.valid_from,
    validTo: r.valid_to,
    notes: r.notes,
    essentialId: r.essential_id || null,
    subjectContactId: r.subject_contact_id || null,
  };
}

async function create({ ownerId, createdBy, country, kind, validFrom, validTo, entriesTotal, notes, subjectContactId, essentialId }) {
  if (!String(country || '').trim()) return { error: 'Which country is the visa for?' };
  if (!isKind(kind)) return { error: 'That is not a kind of visa.' };
  if (validFrom && validTo && validTo < validFrom) {
    return { error: 'It expires before it starts.' };
  }
  const spec = KINDS[kind];
  const total = entriesTotal === undefined || entriesTotal === null || entriesTotal === ''
    ? spec.entries
    : Number(entriesTotal);

  const row = {
    id: crypto.randomUUID(),
    owner_id: ownerId,
    created_by: createdBy,
    subject_contact_id: subjectContactId || null,
    essential_id: essentialId || null,
    country: String(country).trim(),
    kind,
    entries_total: total === null ? null : Math.max(1, total),
    entries_used: 0,
    valid_from: validFrom || null,
    valid_to: validTo || null,
    notes: String(notes || '').trim(),
    created_at: new Date().toISOString(),
  };
  await db.prepare(`
    INSERT INTO visas (id, owner_id, created_by, subject_contact_id, essential_id, country,
                       kind, entries_total, entries_used, valid_from, valid_to, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.owner_id, row.created_by, row.subject_contact_id, row.essential_id,
    row.country, row.kind, row.entries_total, row.entries_used, row.valid_from,
    row.valid_to, row.notes, row.created_at);
  return { visa: serialize(row) };
}

/**
 * What the visas on file say about one trip.
 *
 * Every branch here is a real way a journey falls over, and each is stated as
 * the thing that will happen rather than as a status code:
 *
 *   none      — nothing on file for this country. NOT "you need a visa"; we
 *               do not know that, and saying it would be the guess this
 *               module exists to avoid.
 *   expired   — it lapses before the trip even starts.
 *   expires   — it lapses DURING the trip, which is the one people miss:
 *               valid on the day you fly, invalid on the day you fly home.
 *   not_yet   — issued but not valid until after the trip begins.
 *   spent     — a single-entry already used.
 *   covers    — it holds.
 */
async function coverageFor(ownerId, trip) {
  const country = String(trip.destination || '').trim();
  if (!country) return { country: '', state: 'no_destination', visas: [] };

  const all = await listFor(ownerId);
  const mine = all.filter((v) => v.country.toLowerCase() === country.toLowerCase());
  const processing = processingFor(country);

  if (mine.length === 0) {
    return {
      country,
      state: 'none',
      visas: [],
      processing,
      // Said explicitly, because the absence of a visa on file is not evidence
      // that one is required.
      rulesKnown: rulesConfigured(),
    };
  }

  const start = trip.startsOn;
  const end = trip.endsOn;
  const judged = mine.map((v) => {
    if (v.kind === 'visa_free') return { ...v, state: 'covers' };
    if (v.validTo && v.validTo < start) return { ...v, state: 'expired' };
    if (v.validTo && v.validTo < end) return { ...v, state: 'expires', lastGoodDay: v.validTo };
    if (v.validFrom && v.validFrom > start) return { ...v, state: 'not_yet', firstGoodDay: v.validFrom };
    if (v.entriesTotal !== null && v.entriesUsed >= v.entriesTotal) return { ...v, state: 'spent' };
    return { ...v, state: 'covers' };
  });

  const best = judged.find((v) => v.state === 'covers') || judged[0];
  return { country, state: best.state, visas: judged, processing, rulesKnown: rulesConfigured() };
}

/** An entry spent. Only meaningful where the visa counts them. */
async function useEntry(ownerId, id, delta = 1) {
  const row = await db.prepare('SELECT * FROM visas WHERE id = ? AND owner_id = ?').get(id, ownerId);
  if (!row) return null;
  const used = Math.max(0, Number(row.entries_used || 0) + delta);
  await db.prepare('UPDATE visas SET entries_used = ? WHERE id = ?').run(used, id);
  return serialize({ ...row, entries_used: used });
}

async function remove(ownerId, id) {
  await db.prepare('DELETE FROM visas WHERE id = ? AND owner_id = ?').run(id, ownerId);
}

module.exports = {
  KINDS, isKind, listFor, create, coverageFor, useEntry, remove,
  processingFor, rulesConfigured, PROCESSING_REVIEWED,
};
