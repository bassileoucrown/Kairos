const crypto = require('crypto');
const db = require('./db');

// What a plan includes, and — until launch — what it would have excluded.
//
// The word "tier" is deliberately not used here. It already means two other
// things in this codebase: a meeting type's access tier (1–4, who may book
// you) and a contact's relationship tier (inner circle, close, professional).
// A third meaning would make every conversation about any of them ambiguous,
// so the commercial one is a PLAN.
//
// TWO RULES THAT ARE NOT NEGOTIABLE
//
// 1. Entitlement is never access control. Whether a delegate may see a BVN is
//    decided by lib/essentials.js and a second factor; whether the account is
//    on Plus is decided here. If those two ever merge, a billing bug becomes a
//    data breach, and a lapsed card locks a principal out of their own
//    passport — which is precisely the thing this product exists not to do.
//
// 2. It fails OPEN. A null column, a half-run migration, an unknown plan name:
//    the answer is allow. The failure mode of a strict check is somebody at an
//    airport unable to read their own visa number because a database default
//    did not apply. A month of unpaid Plus costs less than that, every time.
//
// AND ONE MORE, WHICH IS WHY THIS SHIPS BEFORE BILLING DOES
//
// Enforcement is off by default. While it is off, every check still runs, still
// resolves, and RECORDS what it would have refused. The price sheet is a
// hypothesis — trips are on Plus and briefs on Executive because it reads well,
// not because anybody has behaved that way. Some months of "who reached for
// what, on the plan they would have been on" turns those boundaries into
// evidence before a single customer is charged for a guess.

/** Ordered. A plan allows a feature if its rank reaches the feature's. */
const PLANS = {
  free: { rank: 0, label: 'Free' },
  standard: { rank: 1, label: 'Standard' },
  plus: { rank: 2, label: 'Plus' },
  executive: { rank: 3, label: 'Executive' },
  family_office: { rank: 4, label: 'Family Office' },
  enterprise: { rank: 5, label: 'Enterprise' },

  // Everybody who arrives before launch, recorded as a fact in their row
  // rather than as a promise in a spreadsheet. Retroactively taking things
  // away from the first people who trusted you is the reliable way to lose
  // exactly the users who were most willing to say so publicly.
  founding: { rank: 3, label: 'Founding', hidden: true },
};

/** The plan a new account is created on. Set to a paid plan before launch. */
const DEFAULT_PLAN = PLANS[process.env.DEFAULT_PLAN] ? process.env.DEFAULT_PLAN : 'founding';

/** Off unless explicitly switched on, so nothing becomes unreachable by accident. */
const ENFORCED = String(process.env.PLAN_ENFORCEMENT || '').toLowerCase() === 'on';

/**
 * Each gated capability and the plan it starts at.
 *
 * Only creation is ever gated. Reading back something already stored is not a
 * feature, it is custody — a principal who drops from Plus to Standard keeps
 * every trip and every document they put in, and simply cannot add more.
 */
const FEATURES = {
  assistants: { plan: 'standard', label: 'Bringing on an assistant' },
  vault: { plan: 'standard', label: 'The essentials vault' },
  contacts: { plan: 'standard', label: 'Contact intelligence' },
  tasks: { plan: 'standard', label: 'Tasks and reminders' },
  direct_line: { plan: 'standard', label: 'The direct line' },
  spaces: { plan: 'plus', label: 'Spaces and projects' },
  trips: { plan: 'plus', label: 'Trips' },
  voice_notes: { plan: 'plus', label: 'Voice notes' },
  travel_time: { plan: 'plus', label: 'Travel time with live traffic' },
  ai_assist: { plan: 'plus', label: 'AI Assist' },
  household: { plan: 'plus', label: 'Household staff' },
  briefs: { plan: 'executive', label: 'Brief builder' },
  peer_connections: { plan: 'executive', label: 'Connections between offices' },
  held_for_others: { plan: 'executive', label: 'Documents held for other people' },
  concierge: { plan: 'executive', label: 'The concierge desk' },
  many_principals: { plan: 'family_office', label: 'More than one principal' },
  sso: { plan: 'enterprise', label: 'Single sign-on' },
};

function planOf(row) {
  const name = row?.plan;
  return PLANS[name] ? name : DEFAULT_PLAN;
}

/** Whether a plan reaches a feature. Unknown feature ⇒ allowed, by rule 2. */
function allows(plan, feature) {
  const spec = FEATURES[feature];
  if (!spec) return true;
  const have = PLANS[plan] || PLANS[DEFAULT_PLAN];
  const need = PLANS[spec.plan];
  if (!have || !need) return true;
  return have.rank >= need.rank;
}

/**
 * Counts a reach that the current plan does not cover.
 *
 * Aggregated per account and feature rather than appended per event: the
 * question being answered is "which boundaries are in the wrong place", and a
 * row per click would be a log, not an answer.
 */
async function recordReach(ownerId, feature, plan) {
  if (!ownerId) return;
  const now = new Date().toISOString();
  const existing = await db.prepare(
    'SELECT id, times FROM plan_signals WHERE owner_id = ? AND feature = ?',
  ).get(ownerId, feature);
  if (existing) {
    await db.prepare('UPDATE plan_signals SET times = ?, last_at = ?, plan = ? WHERE id = ?')
      .run(Number(existing.times) + 1, now, plan, existing.id);
  } else {
    await db.prepare(`
      INSERT INTO plan_signals (id, owner_id, feature, plan, times, first_at, last_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), ownerId, feature, plan, 1, now, now);
  }
}

/**
 * Express middleware for a gated capability.
 *
 * Runs after requirePaAccess, so it can read the PRINCIPAL's plan — an
 * assistant on a free account of their own is working inside their principal's
 * entitlements, not their own, and billing the wrong party for the right work
 * would be a strange thing to build.
 */
function requirePlan(feature) {
  return async (req, res, next) => {
    const owner = req.principal || req.user;
    let plan = DEFAULT_PLAN;
    try {
      const row = await db.prepare('SELECT plan FROM users WHERE id = ?').get(owner?.id);
      plan = planOf(row);
    } catch {
      return next(); // Rule 2: unreadable means allowed.
    }

    if (allows(plan, feature)) return next();

    // Reached for, and not covered. Counted either way; refused only when the
    // switch is on.
    try { await recordReach(owner?.id, feature, plan); } catch { /* never blocks */ }
    if (!ENFORCED) return next();

    const spec = FEATURES[feature];
    return res.status(402).json({
      error: `${spec.label} is part of ${PLANS[spec.plan].label}.`,
      feature,
      plan,
      needsPlan: spec.plan,
    });
  };
}

/** What this account may do, for a screen that wants to say so up front. */
async function stateFor(userId) {
  let plan = DEFAULT_PLAN;
  try {
    plan = planOf(await db.prepare('SELECT plan FROM users WHERE id = ?').get(userId));
  } catch { /* default */ }
  const features = {};
  for (const key of Object.keys(FEATURES)) features[key] = allows(plan, key);
  return {
    plan,
    label: PLANS[plan]?.label || plan,
    enforced: ENFORCED,
    features,
  };
}

module.exports = {
  PLANS, FEATURES, DEFAULT_PLAN, ENFORCED,
  allows, planOf, requirePlan, recordReach, stateFor,
};
