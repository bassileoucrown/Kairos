// Assistant titles, in one place.
//
// Signup asks whether someone is a PA, an EA, or a Chief of Staff. Until now
// that answer went nowhere: invitations offered only "PA" or "delegate", so a
// Chief of Staff was appointed as somebody's PA and saw that word on every
// screen. These are titles, not tiers — a Chief of Staff is not a senior PA,
// and none of them outranks another. What actually differs is `delegate`,
// which is a genuinely narrower remit rather than a different name for the
// same one.

const ASSISTANT_ROLES = {
  pa: {
    label: 'PA',
    description: 'Personal Assistant — approvals, briefs, contacts, comms, itinerary',
    fullAccess: true,
  },
  ea: {
    label: 'EA',
    description: 'Executive Assistant — approvals, briefs, contacts, comms, itinerary',
    fullAccess: true,
  },
  chief_of_staff: {
    label: 'Chief of Staff',
    description: 'Chief of Staff — approvals, briefs, contacts, comms, itinerary',
    fullAccess: true,
  },
  delegate: {
    label: 'Delegate',
    description: 'Scheduling only — availability and meeting types',
    fullAccess: false,
  },
};

const ROLE_IDS = Object.keys(ASSISTANT_ROLES);

function isAssistantRole(role) {
  return Object.prototype.hasOwnProperty.call(ASSISTANT_ROLES, role);
}

function roleLabel(role) {
  return ASSISTANT_ROLES[role]?.label || 'Assistant';
}

/**
 * The membership role that matches how someone described themselves at
 * signup, so an invitation can default to the right title instead of making
 * the principal guess it. Falls back to `pa` for a principal being invited as
 * someone else's assistant, which is legitimate — plenty of people are both.
 */
function roleForAccountCategory(accountCategory) {
  return isAssistantRole(accountCategory) ? accountCategory : 'pa';
}

module.exports = { ASSISTANT_ROLES, ROLE_IDS, isAssistantRole, roleLabel, roleForAccountCategory };
