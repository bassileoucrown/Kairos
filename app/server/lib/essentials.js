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
      // Required at Nigerian ports of entry and exit, and asked for by name
      // rather than as "a vaccination certificate" — which is why it is its own
      // field with its own expiry rather than a note on the generic one.
      { id: 'yellow_fever_card', label: 'Yellow fever card', expires: true },
    ],
  },
  {
    // Nigeria issues several identity numbers, and they are not
    // interchangeable: a bank wants the BVN, a telco wants the NIN, an invoice
    // wants the TIN, and a PA is asked for two of them in the same phone call.
    // One generic "National ID" field forces a choice between them, which is
    // why they are listed separately here.
    //
    // Sensitivity is decided per field rather than per category, which is the
    // whole reason this is a separate group. A BVN is a key to somebody's
    // banking and a delegate has no business seeing it; an RC number is printed
    // on the company letterhead and withholding it would be theatre.
    id: 'identity_numbers',
    label: 'Identity and registration numbers',
    hint: 'The numbers institutions ask for by name.',
    sensitivity: 'sensitive',
    fields: [
      { id: 'bvn', label: 'BVN (Bank Verification Number)', expires: false },
      { id: 'nin', label: 'NIN (National Identification Number)', expires: false },
      { id: 'voters_card', label: "Voter's card (PVC)", expires: false },
      { id: 'social_security', label: 'Social security / equivalent', expires: false },
      { id: 'tin', label: 'TIN (Tax Identification Number)', expires: false, sensitivity: 'ordinary' },
      { id: 'rc_number', label: 'RC number (CAC registration)', expires: false, sensitivity: 'ordinary' },
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
      { id: 'hmo_provider', label: 'HMO provider and plan number', expires: true },
      { id: 'emergency_contact', label: 'Emergency contact', expires: false },
      { id: 'next_of_kin', label: 'Next of kin', expires: false },
      { id: 'blood_type', label: 'Blood type', expires: false },
      // Asked on essentially every Nigerian hospital admission form, and not
      // derivable from blood type — they are different tests answering
      // different questions.
      { id: 'genotype', label: 'Genotype', expires: false },
      { id: 'medications', label: 'Regular medications', expires: false },
      { id: 'doctor', label: 'Doctor or preferred hospital', expires: false },
      { id: 'vaccination', label: 'Other vaccination certificate', expires: true },
    ],
  },
  {
    // Asked constantly and answered from memory badly: the plate the gate needs,
    // the address a courier needs. Ordinary, because a delegate arranging a car
    // or a delivery cannot do the job without them.
    //
    // Home address is deliberately NOT here. For a principal in this market it
    // is the single most dangerous field the app could hold, and it should not
    // arrive under the same tier that lets a scheduling delegate read a seat
    // preference. See the note under canSee.
    id: 'logistics',
    label: 'Vehicles and addresses',
    hint: 'What a gate, a courier or a car park asks for.',
    sensitivity: 'ordinary',
    fields: [
      { id: 'vehicle_plate', label: 'Vehicle plate number', expires: false },
      { id: 'vehicle_description', label: 'Vehicle make and colour', expires: false },
      { id: 'office_address', label: 'Office address', expires: false },
      { id: 'delivery_address', label: 'Delivery address', expires: false },
    ],
  },
  {
    // Who to call when something has gone wrong and the principal cannot be
    // asked. Sensitive: knowing who holds somebody's power of attorney is a
    // map of how to reach their affairs.
    id: 'advisers',
    label: 'Advisers',
    hint: 'Who to call, when it is not a scheduling question.',
    sensitivity: 'sensitive',
    fields: [
      { id: 'lawyer', label: 'Lawyer', expires: false },
      { id: 'accountant', label: 'Accountant', expires: false },
      { id: 'company_secretary', label: 'Company secretary', expires: false },
      { id: 'bank_relationship_manager', label: 'Bank relationship manager', expires: false },
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
      { id: 'social_handles', label: 'Social handles', expires: false },
    ],
  },
];

const BY_CATEGORY = new Map(CATEGORIES.map((c) => [c.id, c]));

/**
 * A field's own sensitivity, falling back to its category's.
 *
 * Most categories are uniform and say so once. Identity numbers are not: a BVN
 * is a key to somebody's banking, an RC number is printed on the letterhead,
 * and they sit together because that is where a person looks for them — not
 * because they deserve the same protection. Marking the whole group sensitive
 * would be easier and would teach assistants that the marking means nothing.
 */
function sensitivityOf(category, field) {
  return field?.sensitivity || category.sensitivity;
}

function findField(categoryId, fieldId) {
  const category = BY_CATEGORY.get(categoryId);
  if (!category) return null;
  const field = category.fields.find((f) => f.id === fieldId);
  if (!field) return null;
  return { category, field, sensitivity: sensitivityOf(category, field) };
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
  CATEGORIES, BY_CATEGORY, findField, sensitivityOf, canSee,
  daysUntil, expiryState, EXPIRY_WARN_DAYS,
};
