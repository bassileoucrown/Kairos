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
// ─────────────────────────────────────────────────────────────────────────
// THREE RULES THAT ARE NOT NEGOTIABLE
// ─────────────────────────────────────────────────────────────────────────
//
// 1. ENTITLEMENT IS NEVER ACCESS CONTROL. Whether a delegate may see a BVN is
//    decided by lib/essentials.js and a second factor; whether the account is
//    on Office is decided here. If those two ever merge, a billing bug becomes
//    a data breach, and a lapsed card locks a principal out of their own
//    passport — precisely the thing this product exists not to do.
//
// 2. IT FAILS OPEN. A null column, a half-run migration, an unknown plan name:
//    the answer is allow. The failure mode of a strict check is somebody at an
//    airport unable to read their own visa number because a database default
//    did not apply. A month of unpaid Office costs less than that, every time.
//
// 3. SAFETY IS NEVER GATED — and this rule is why the file was restructured.
//    Kairos now carries a duress alarm, unconfirmed-arrival alerts and driver
//    licence expiry. If enforcement were switched on with movements behind a
//    plan, a lapsed card could silence a panic button. That is rule 1's
//    failure mode with somebody in a car instead of at a check-in desk. So the
//    things that keep a person safe, tell them what has already been stored,
//    or let them leave with their own data are enumerated in NEVER_GATED
//    below, and a test asserts none of them can appear in FEATURES.
//
// ─────────────────────────────────────────────────────────────────────────
// AND ONE MORE, WHICH IS WHY THIS SHIPS BEFORE BILLING DOES
// ─────────────────────────────────────────────────────────────────────────
//
// Enforcement is off by default. While it is off, every check still runs,
// still resolves, and RECORDS what it would have refused. The price sheet is a
// hypothesis. Some months of "who reached for what, on the plan they would
// have been on" turns these boundaries into evidence before a single customer
// is charged for a guess.

/**
 * The ladder, and what each rung MEANS.
 *
 * The rungs were named for a scheduling product and the product is now custody
 * and coordination for a principal's office, so each one is defined by the
 * question it answers rather than by a bundle of features. A buyer who cannot
 * repeat the sentence back has been sold a list.
 */
const PLANS = {
  free: { rank: 0, label: 'Free', question: 'Let people book me.' },
  principal: { rank: 1, label: 'Principal', question: 'Run my own day, and keep my own papers.' },
  office: { rank: 2, label: 'Office', question: 'Run it with the people who work for me.' },
  executive: { rank: 3, label: 'Executive', question: 'Work across other people\'s offices.' },
  family_office: { rank: 4, label: 'Family Office', question: 'More than one principal.' },
  enterprise: { rank: 5, label: 'Enterprise', question: 'Inside an institution.' },

  // Everybody who arrives before launch, recorded as a fact in their row
  // rather than as a promise in a spreadsheet. Retroactively taking things
  // away from the first people who trusted you is the reliable way to lose
  // exactly the users who were most willing to say so publicly.
  founding: { rank: 4, label: 'Founding', hidden: true },
};

/**
 * What the old rungs became.
 *
 * NOT a cosmetic rename. Rows in the database say `standard` and `plus`, and
 * without this planOf() would fall through to "unknown" and hand those
 * accounts the default — which is a silent re-pricing of existing customers
 * performed by a deploy. Every retired name maps to the rung that inherited
 * its meaning, and none of them maps downwards.
 */
const ALIASES = {
  standard: 'principal',
  plus: 'office',
};

/** The plan a new account is created on. Set to a paid plan before launch. */
const DEFAULT_PLAN = PLANS[process.env.DEFAULT_PLAN] ? process.env.DEFAULT_PLAN : 'founding';

/** Off unless explicitly switched on, so nothing becomes unreachable by accident. */
const ENFORCED = String(process.env.PLAN_ENFORCEMENT || '').toLowerCase() === 'on';

/**
 * What no plan may ever withhold.
 *
 * Enumerated rather than left as a principle, because a principle in a comment
 * is a principle somebody will not read at four in the afternoon while adding
 * a feature. Anything named here is guaranteed to be missing from FEATURES,
 * and bplan.js fails if it ever is not.
 *
 * Four kinds, and each is here for a different reason:
 *
 *   SAFETY — a duress signal, an arrival nobody confirmed, a driver whose
 *   licence has run out. Silencing an alarm over an invoice is indefensible
 *   at any price.
 *
 *   CUSTODY — reading back what is already stored. Somebody who drops from
 *   Office to Principal keeps every document and every trip they put in; they
 *   simply cannot add more. Holding a passport number hostage is the exact
 *   behaviour this product was built against.
 *
 *   SECURITY — the second factor, the device list, signing another session
 *   out, the access code. A plan that could disable these would make a lapsed
 *   card into a way in.
 *
 *   LEAVING — taking your own data out. A product that is hard to leave is
 *   one that has stopped competing on being good.
 */
const NEVER_GATED = Object.freeze({
  movement_safety: 'Duress, arrival alarms, and driver papers running out',
  custody_read: 'Reading anything already stored',
  account_security: 'Two-factor, devices, sign-out, and the access code',
  data_export: 'Taking your own records out',
});

/**
 * Each gated capability and the plan it starts at.
 *
 * ONLY CREATION IS EVER GATED. Reading back something already stored is not a
 * feature, it is custody — see NEVER_GATED.
 *
 * Ordered by rung so the sheet can be read as a sheet.
 */
const FEATURES = {
  // ---- Principal: one person, running their own day ----------------------
  vault: { plan: 'principal', label: 'The essentials vault' },
  contacts: { plan: 'principal', label: 'Contact intelligence' },
  tasks: { plan: 'principal', label: 'Tasks and reminders' },
  pad: { plan: 'principal', label: 'The pad' },
  // TAKING ON A PRINCIPAL WHO IS NOT ON KAIROS — and deliberately NOT the same
  // feature as bringing on an assistant, which sits a rung higher.
  //
  // They look alike and are opposites. `assistants` is a principal paying to
  // add people to their office. This is one assistant, alone, paying to do
  // their job for somebody who will never sign in — the whole point being that
  // it is reachable by a single person on the first paid rung. Gated as
  // `assistants` it would have sat on Office, which would have made the
  // assistant-led lane cost twice what it is meant to and put it out of reach
  // of exactly the buyer it exists for.
  kept_principals: { plan: 'principal', label: 'A principal who is not on Kairos' },
  trips: { plan: 'principal', label: 'Trips' },
  direct_line: { plan: 'principal', label: 'The direct line' },
  // THE FLEET, NEVER THE JOURNEY — and the distinction is not pedantry.
  //
  // An arrival alarm and a duress signal only exist for a movement that
  // exists, so gating "create a movement" would gate the alarms through the
  // back door and break rule 3 while appearing to respect it. What is charged
  // for is keeping a roster of cars and drivers and standing weekly runs.
  // Recording a journey, and being warned when nobody confirmed it arrived,
  // is free on every plan including Free.
  movement_fleet: { plan: 'principal', label: 'Vehicles, drivers and standing journeys' },
  own_report: { plan: 'principal', label: 'Your own weekly report' },

  // ---- Office: the people who work for you --------------------------------
  assistants: { plan: 'office', label: 'Bringing on an assistant' },
  spaces: { plan: 'office', label: 'Spaces and projects' },
  // The assistant product. On Office rather than Executive because
  // correspondence handled on a principal's behalf IS what an office does,
  // and two rungs up is a rung most accounts never reach.
  mail: { plan: 'office', label: 'Correspondence handled for you' },
  minutes: { plan: 'office', label: 'Minutes of meetings' },
  household: { plan: 'office', label: 'Household staff' },
  voice_notes: { plan: 'office', label: 'Voice notes' },
  archive: { plan: 'office', label: 'The archive' },
  // The artefact a principal forwards to a lawyer or an accountant. This is
  // where an office decides the product is real.
  office_report: { plan: 'office', label: 'Reports across the office' },

  // ---- Executive: beyond your own office ----------------------------------
  briefs: { plan: 'executive', label: 'Brief builder' },
  peer_connections: { plan: 'executive', label: 'Connections between offices' },
  held_for_others: { plan: 'executive', label: 'Documents held for other people' },
  concierge: { plan: 'executive', label: 'The concierge desk' },

  // ---- Family office and institution --------------------------------------
  many_principals: { plan: 'family_office', label: 'More than one principal' },
  sso: { plan: 'enterprise', label: 'Single sign-on' },
};

/**
 * What costs real money every time somebody uses it.
 *
 * A DIFFERENT INSTRUMENT FROM A PLAN, and confusing the two is how software
 * companies lose money quietly. Every feature above is near-zero marginal
 * cost: gating it is a decision about who the product is for. These four are
 * not — a model call, a transcription, a maps lookup and a stored recording
 * are invoiced to us per use, and a Principal account that records two
 * meetings a year costs less to run than an Office account that records forty.
 * Ranking them on the ladder would charge the wrong people.
 *
 * So they carry an ALLOWANCE per plan instead. Like the ladder, this is
 * recorded and not yet enforced: what it is for right now is finding out what
 * an allowance should be, rather than asserting one.
 */
const METERED = {
  ai_assist: {
    label: 'AI Assist',
    unit: 'asks',
    // Free gets none because there is no card to stop a bill.
    allowance: { free: 0, principal: 50, office: 250, executive: 1000, family_office: 3000, enterprise: 10000 },
  },
  meeting_recording: {
    label: 'Recording and transcription',
    unit: 'hours',
    allowance: { free: 0, principal: 2, office: 10, executive: 40, family_office: 120, enterprise: 400 },
  },
  travel_time: {
    label: 'Travel time with live traffic',
    unit: 'lookups',
    allowance: { free: 0, principal: 100, office: 500, executive: 2000, family_office: 6000, enterprise: 20000 },
  },
  flight_status: {
    label: 'Live flight status',
    unit: 'lookups',
    allowance: { free: 0, principal: 50, office: 250, executive: 1000, family_office: 3000, enterprise: 10000 },
  },
};

/**
 * What a stored value that means nothing resolves to.
 *
 * A RUNG THAT ALLOWS EVERYTHING, and it is not the same thing as the default
 * plan — which is the distinction this used to be missing. Falling back to
 * DEFAULT_PLAN reads like rule 2 and is not rule 2: the day an operator sets
 * DEFAULT_PLAN to `free` before launch, every account whose column was left
 * empty by a half-run migration is silently refused. That is precisely the
 * airport failure rule 2 exists to prevent, arriving through the mechanism
 * meant to prevent it.
 *
 * So corruption and absence resolve HERE, and a new account's starting plan
 * is a separate question answered at signup by DEFAULT_PLAN.
 */
const UNRECOGNISED = '__unrecognised__';

/**
 * The stored name, an alias resolved, or the rung that allows everything.
 *
 * Never a demotion, and never a refusal on the strength of a value nobody
 * recognises.
 */
function planOf(row) {
  const raw = String(row?.plan || '').trim();
  // Empty is corruption, not a choice: the signup path always writes a value.
  if (!raw) return UNRECOGNISED;
  const name = ALIASES[raw] || raw;
  return PLANS[name] ? name : UNRECOGNISED;
}

/** Whether a plan reaches a feature. Unknown feature or plan ⇒ allowed. */
function allows(plan, feature) {
  const spec = FEATURES[feature];
  if (!spec) return true;
  if (plan === UNRECOGNISED) return true;
  const have = PLANS[plan];
  const need = PLANS[spec.plan];
  if (!have || !need) return true;
  return have.rank >= need.rank;
}

/** How much of a metered thing this plan includes in a month. */
function allowanceFor(plan, metered) {
  const spec = METERED[metered];
  if (!spec) return null;
  const name = PLANS[plan] ? plan : DEFAULT_PLAN;
  const n = spec.allowance[name];
  return Number.isFinite(n) ? n : null;
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
 * Counts one use of something we are invoiced for.
 *
 * Recorded whether or not it is over the allowance, because the number that
 * settles what an allowance should be is what people actually do — not what
 * they did after being stopped. Never refuses; nothing calls it expecting one.
 */
async function recordUse(ownerId, metered, plan) {
  if (!ownerId || !METERED[metered]) return;
  await recordReach(ownerId, `metered:${metered}`, plan);
}

/**
 * Count one use of something we are invoiced for, from inside a handler.
 *
 * NOT MIDDLEWARE, and that is the whole difference from requirePlan. A plan
 * check has to run before the work; a meter has to run after it, because what
 * is being counted is a call that actually happened and actually cost
 * something. A model call that refused for want of a key, or a maps lookup on
 * a deployment with no maps key, cost nothing and must not appear in the
 * evidence as demand.
 *
 * Never throws. Nothing that has already succeeded should fail because a
 * counter did.
 */
async function meterUse(req, metered) {
  const owner = req.principal || req.user;
  try {
    const row = await db.prepare('SELECT plan FROM users WHERE id = ?').get(owner?.id);
    await recordUse(owner?.id, metered, planOf(row));
  } catch { /* a count is never worth an error */ }
}

/**
 * Express middleware for a gated capability.
 *
 * Runs after requirePaAccess, so it can read the PRINCIPAL's plan — an
 * assistant on a free account of their own is working inside their principal's
 * entitlements, not their own, and billing the wrong party for the right work
 * would be a strange thing to build.
 */
function requirePlan(feature, resolveOwnerId = null) {
  return async (req, res, next) => {
    let plan = DEFAULT_PLAN;
    try {
      // WHOSE PLAN, in three ways, narrowest first.
      //
      // A resolver is passed where the owner is neither the signed-in user nor
      // a principal on the path — a task created in somebody else's space is
      // the case, and without it the reach would be recorded against the
      // ASSISTANT. Enforcement is off, so today that costs nothing except the
      // one thing this file exists to produce: evidence about which boundaries
      // are in the wrong place, attributed to the wrong account.
      const ownerId = resolveOwnerId
        ? await resolveOwnerId(req)
        : (req.principal || req.user)?.id;
      if (!ownerId) return next();
      req.planOwnerId = ownerId;
      const row = await db.prepare('SELECT plan FROM users WHERE id = ?').get(ownerId);
      plan = planOf(row);
    } catch {
      return next(); // Rule 2: unreadable means allowed.
    }

    if (allows(plan, feature)) return next();

    // Reached for, and not covered. Counted either way; refused only when the
    // switch is on.
    try { await recordReach(req.planOwnerId, feature, plan); } catch { /* never blocks */ }
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
  const metered = {};
  for (const key of Object.keys(METERED)) {
    metered[key] = { label: METERED[key].label, unit: METERED[key].unit, allowance: allowanceFor(plan, key) };
  }
  return {
    plan,
    // Said plainly rather than dressed as a real plan. An operator seeing
    // "unrecognised" on an account has been handed a fact worth acting on;
    // seeing "Founding" would hide it.
    label: PLANS[plan]?.label || (plan === UNRECOGNISED ? 'Unrecognised' : plan),
    question: PLANS[plan]?.question || '',
    enforced: ENFORCED,
    features,
    metered,
    // Sent so a screen can say what is never at risk, which is worth as much
    // to a nervous buyer as the list of what they are getting.
    neverGated: NEVER_GATED,
  };
}

module.exports = {
  PLANS, FEATURES, METERED, ALIASES, NEVER_GATED, DEFAULT_PLAN, ENFORCED, UNRECOGNISED,
  allows, allowanceFor, planOf, requirePlan, recordReach, recordUse, meterUse, stateFor,
};
