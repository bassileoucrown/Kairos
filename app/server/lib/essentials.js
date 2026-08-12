// The catalogue of things people are asked for and cannot recall.
//
// Not "documents" — answers. Every entry here is a question somebody else
// puts to a principal: an airline, a hotel, a visa form, an event organiser.
// That is why the useful unit is a field with a copy button rather than a
// folder with a file in it.
//
// `sensitivity` is the load-bearing property. An assistant engaged for
// scheduling has every reason to know about a nut allergy and no reason at
// all to see a passport number, so the catalogue itself decides which fields
// a narrower remit can reach. Adding a field means deciding this, once, here.

const CATEGORIES = [
  {
    id: 'travel_identity',
    label: 'Travel identity',
    hint: 'What an airline or border asks for.',
    sensitivity: 'sensitive',
    fields: [
      { id: 'full_name_as_printed', label: 'Full name, as printed', expires: false },
      { id: 'passport_number', label: 'Passport number', expires: true },
      { id: 'passport_country', label: 'Passport issuing country', expires: false },
      { id: 'nationality', label: 'Nationality', expires: false },
      { id: 'visa', label: 'Visa', expires: true },
      { id: 'known_traveller_number', label: 'Known Traveller / Global Entry', expires: true },
      { id: 'national_id', label: 'National ID', expires: true },
      { id: 'driving_licence', label: 'Driving licence', expires: true },
    ],
  },
  {
    id: 'loyalty',
    label: 'Loyalty and memberships',
    hint: 'Never memorised, asked for every booking.',
    sensitivity: 'ordinary',
    fields: [
      { id: 'frequent_flyer', label: 'Frequent flyer', expires: false },
      { id: 'hotel_loyalty', label: 'Hotel loyalty', expires: false },
      { id: 'car_rental', label: 'Car rental membership', expires: false },
      { id: 'lounge', label: 'Lounge membership', expires: true },
    ],
  },
  {
    id: 'preferences',
    label: 'Preferences',
    hint: 'Asked every single time, answered from memory badly.',
    sensitivity: 'ordinary',
    fields: [
      { id: 'seat_preference', label: 'Seat', expires: false },
      { id: 'meal_preference', label: 'Meal', expires: false },
      { id: 'dietary_requirements', label: 'Dietary requirements', expires: false },
      { id: 'allergies', label: 'Allergies', expires: false },
      { id: 'hotel_preference', label: 'Hotel room', expires: false },
      { id: 'car_preference', label: 'Car', expires: false },
    ],
  },
  {
    id: 'sizes',
    label: 'Sizes',
    hint: 'For gifts, tailoring and event kit.',
    sensitivity: 'ordinary',
    fields: [
      { id: 'shirt_size', label: 'Shirt', expires: false },
      { id: 'suit_size', label: 'Suit', expires: false },
      { id: 'shoe_size', label: 'Shoe', expires: false },
      { id: 'dress_size', label: 'Dress', expires: false },
    ],
  },
  {
    id: 'protection',
    label: 'Insurance and emergencies',
    hint: 'Asked at the worst possible moment.',
    sensitivity: 'sensitive',
    fields: [
      { id: 'travel_insurance', label: 'Travel insurance policy', expires: true },
      { id: 'health_insurance', label: 'Health insurance policy', expires: true },
      { id: 'emergency_contact', label: 'Emergency contact', expires: false },
      { id: 'next_of_kin', label: 'Next of kin', expires: false },
      { id: 'blood_type', label: 'Blood type', expires: false },
      { id: 'vaccination', label: 'Vaccination certificate', expires: true },
    ],
  },
  {
    id: 'professional',
    label: 'Professional',
    hint: 'What organisers ask for, always urgently.',
    sensitivity: 'ordinary',
    fields: [
      { id: 'bio_short', label: 'Short bio', expires: false },
      { id: 'bio_long', label: 'Long bio', expires: false },
      { id: 'job_title', label: 'Job title', expires: false },
      { id: 'company_boilerplate', label: 'Company boilerplate', expires: false },
      { id: 'av_requirements', label: 'AV and speaking requirements', expires: false },
    ],
  },
];

const BY_CATEGORY = new Map(CATEGORIES.map((c) => [c.id, c]));

function findField(categoryId, fieldId) {
  const category = BY_CATEGORY.get(categoryId);
  if (!category) return null;
  const field = category.fields.find((f) => f.id === fieldId);
  if (!field) return null;
  return { category, field, sensitivity: category.sensitivity };
}

/**
 * Whether this viewer may see a given sensitivity for a given principal.
 *
 * The principal always may. An assistant with a full-access title may. A
 * delegate — engaged for scheduling and nothing else — sees ordinary fields
 * and never sensitive ones. That is the whole reason `sensitivity` exists.
 */
function canSee(sensitivity, { isOwner, role }) {
  if (isOwner) return true;
  if (sensitivity !== 'sensitive') return true;
  return role === 'pa' || role === 'ea' || role === 'chief_of_staff';
}

// A passport must be valid for six months beyond arrival in much of the
// world, so "expired" is far too late to start worrying and even "expires
// next month" can already have cost a trip.
const EXPIRY_WARN_DAYS = 180;

function daysUntil(dateStr, now = Date.now()) {
  if (!dateStr) return null;
  const then = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  return Math.floor((then - now) / 86400000);
}

/** null when there is nothing to say; otherwise 'expired' or 'expiring'. */
function expiryState(dateStr, now = Date.now()) {
  const days = daysUntil(dateStr, now);
  if (days === null) return null;
  if (days < 0) return 'expired';
  if (days <= EXPIRY_WARN_DAYS) return 'expiring';
  return null;
}

module.exports = {
  CATEGORIES, BY_CATEGORY, findField, canSee, daysUntil, expiryState, EXPIRY_WARN_DAYS,
};
